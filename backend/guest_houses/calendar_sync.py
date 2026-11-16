"""
guest_houses.calendar_sync — keeps a guest house's availability the same on Oaziland and on the booking sites it is
listed on, using iCal calendars.

- Import: each connected channel's calendar is read hourly and its taken nights block the house here, so Oaziland
  guests can't book a night someone already booked on Airbnb or Booking.com. A night that disappears from the
  channel's calendar (a cancellation) is freed again. A calendar that can't be read leaves the old blocks in place
  rather than wiping them.
- Export: every channel gets its own private Oaziland feed (Oaziland reservations plus nights booked on the OTHER
  channels), so a booking made here, or on one site, blocks the others once they re-read it.
- A night the channel says is taken but Oaziland had already sold is never silently overwritten: the owner is told.
"""
import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .ical import CalendarFetchError, build_calendar, fetch_calendar, parse_busy_nights
from .models import ChannelBlockedDate, ChannelListing, OTAChannel

logger = logging.getLogger(__name__)


def live_oaziland_stays(guest_house, now=None):
    """Reservations made on Oaziland that currently hold nights of this guest house."""
    from django.db.models import Q
    from hotels.models import Reservation, ReservationStatus
    from hotels.room_types import PAYMENT_HOLD_MINUTES

    now = now or timezone.now()
    return Reservation.objects.filter(guest_house=guest_house).filter(
        Q(status__in=[ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN])
        | Q(status=ReservationStatus.PENDING_PAYMENT, created_at__gte=now - timedelta(minutes=PAYMENT_HOLD_MINUTES))
    )


def _stay_nights(guest_house, now=None) -> set:
    nights = set()
    for check_in, check_out in live_oaziland_stays(guest_house, now).values_list("check_in", "check_out"):
        night = check_in
        while night < check_out:
            nights.add(night)
            night += timedelta(days=1)
    return nights


def sync_channel_calendar(listing: ChannelListing, *, fetch=fetch_calendar, now=None) -> dict:
    """Reads one channel's calendar and reconciles the nights it blocks here. Returns what changed."""
    now = now or timezone.now()
    today = timezone.localdate(now)
    guest_house = listing.guest_house
    try:
        nights = parse_busy_nights(fetch(listing.channel, listing.calendar_url), today=today)
    except CalendarFetchError as exc:
        ChannelListing.objects.filter(pk=listing.pk).update(last_error=str(exc)[:255])
        listing.last_error = str(exc)[:255]
        return {"ok": False, "error": str(exc), "added": 0, "removed": 0, "conflicts": []}

    ours = _stay_nights(guest_house, now)
    conflicts = sorted(nights & ours)
    wanted = nights - ours
    added = removed = 0
    with transaction.atomic():
        existing = ChannelBlockedDate.objects.filter(guest_house=guest_house, source_channel=listing.channel, booking__isnull=True)
        stale = [row.pk for row in existing if row.date not in wanted]
        removed = len(stale)
        ChannelBlockedDate.objects.filter(pk__in=stale).delete()
        for night in sorted(wanted):
            _, created = ChannelBlockedDate.objects.get_or_create(
                guest_house=guest_house, date=night, defaults={"source_channel": listing.channel},
            )
            added += int(created)
        conflict_text = ",".join(d.isoformat() for d in conflicts)
        changed = conflict_text != listing.conflict_nights
        ChannelListing.objects.filter(pk=listing.pk).update(last_synced_at=now, last_error="", conflict_nights=conflict_text)
    listing.last_synced_at, listing.last_error, listing.conflict_nights = now, "", conflict_text
    if conflicts and changed:
        _warn_owner(listing, conflicts)
    return {"ok": True, "error": "", "added": added, "removed": removed, "conflicts": conflicts}


def _warn_owner(listing, conflicts):
    from notifications.services import notify_important

    shown = ", ".join(d.isoformat() for d in conflicts[:5]) + ("..." if len(conflicts) > 5 else "")
    notify_important(
        recipient=listing.guest_house.owner, notification_type="CHANNEL_CONFLICT",
        title="A booking site double-booked a night",
        message=(
            f"{listing.get_channel_display()} shows a booking on {shown}, but guests already booked "
            f"{listing.guest_house.name or 'your guest house'} on Oaziland for those nights. Contact one of the guests to move their stay."
        ),
        related_reference=str(listing.guest_house_id),
    )


def disconnect_channel(listing: ChannelListing):
    """Stops syncing and frees the nights this channel was blocking."""
    with transaction.atomic():
        ChannelBlockedDate.objects.filter(guest_house=listing.guest_house, source_channel=listing.channel, booking__isnull=True).delete()
        listing.is_active = False
        listing.calendar_url = ""
        listing.conflict_nights = ""
        listing.save(update_fields=["is_active", "calendar_url", "conflict_nights"])


def feed_events(listing: ChannelListing, now=None) -> list:
    """What Oaziland tells a channel is taken: its own reservations, plus nights booked on the other channels or
    blocked by the owner. The channel's own bookings are left out so it never re-imports itself."""
    now = now or timezone.now()
    today = timezone.localdate(now)
    guest_house = listing.guest_house
    events = []
    for stay in live_oaziland_stays(guest_house, now).filter(check_out__gt=today):
        events.append((f"oaziland-stay-{stay.pk}@oaziland.com", stay.check_in, stay.check_out, "Reserved (Oaziland)"))
    blocks = ChannelBlockedDate.objects.filter(guest_house=guest_house, date__gte=today).exclude(source_channel=listing.channel).order_by("source_channel", "date")
    run = None
    for block in blocks:
        if run and run["source"] == block.source_channel and run["end"] == block.date:
            run["end"] = block.date + timedelta(days=1)
            continue
        if run:
            events.append(_run_event(run))
        run = {"source": block.source_channel, "start": block.date, "end": block.date + timedelta(days=1)}
    if run:
        events.append(_run_event(run))
    return events


def _run_event(run):
    label = "Blocked" if run["source"] == OTAChannel.DIRECT else "Reserved (other site)"
    return (f"oaziland-block-{run['source']}-{run['start'].isoformat()}@oaziland.com", run["start"], run["end"], label)


def render_feed(listing: ChannelListing, now=None) -> str:
    now = now or timezone.now()
    name = listing.guest_house.name or "Oaziland guest house"
    return build_calendar(name=name, events=feed_events(listing, now), now=now)


def sync_all_channel_calendars(*, fetch=fetch_calendar, now=None) -> dict:
    """The hourly sweep over every connected channel; one failing channel never stops the others."""
    summary = {"synced": 0, "failed": 0}
    for listing in ChannelListing.objects.filter(is_active=True).exclude(calendar_url="").select_related("guest_house__owner"):
        try:
            result = sync_channel_calendar(listing, fetch=fetch, now=now)
        except Exception:
            logger.exception("Calendar sync crashed for channel listing %s", listing.pk)
            summary["failed"] += 1
            continue
        summary["synced" if result["ok"] else "failed"] += 1
    return summary
