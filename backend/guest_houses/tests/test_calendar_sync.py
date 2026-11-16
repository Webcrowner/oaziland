"""Booking-site calendars: Airbnb / Booking.com bookings block nights on Oaziland, and Oaziland reservations block
nights there, using iCal feeds."""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from guest_houses.calendar_sync import render_feed, sync_all_channel_calendars, sync_channel_calendar
from guest_houses.ical import CalendarFetchError, parse_busy_nights, validate_calendar_url
from guest_houses.models import ChannelBlockedDate, ChannelListing
from hotels.room_types import save_room_type
from hotels.tests.test_room_types import _book, _client, _guest, guest_house, hotel  # noqa: F401
from notifications.models import Notification

AIRBNB_URL = "https://www.airbnb.com/calendar/ical/12345.ics?s=abc"


def _ics(*events):
    body = "".join(
        f"BEGIN:VEVENT\r\nUID:{i}@x\r\nDTSTART;VALUE=DATE:{start:%Y%m%d}\r\nDTEND;VALUE=DATE:{end:%Y%m%d}\r\nSUMMARY:Reserved\r\n{extra}END:VEVENT\r\n"
        for i, (start, end, extra) in enumerate(events)
    )
    return f"BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{body}END:VCALENDAR\r\n"


def _day(n):
    return timezone.localdate() + timedelta(days=n)


def _fetcher(text):
    return lambda channel, url: text


def _connect(guest_house, channel="AIRBNB", url=AIRBNB_URL):
    return ChannelListing.objects.create(guest_house=guest_house, channel=channel, calendar_url=url)


@pytest.mark.django_db
def test_an_airbnb_booking_blocks_those_nights_and_a_cancellation_frees_them(guest_house):
    room_type = save_room_type(guest_house, {"name": "Chambre", "capacity": 2, "base_rate_xaf": "20000", "room_count": 3})
    listing = _connect(guest_house)

    result = sync_channel_calendar(listing, fetch=_fetcher(_ics((_day(10), _day(13), ""))))
    assert result["ok"] and result["added"] == 3
    assert set(ChannelBlockedDate.objects.values_list("date", flat=True)) == {_day(10), _day(11), _day(12)}
    assert _book(_guest("cal_guest_1"), room_type, _day(11), _day(12)).status_code == 409
    assert _book(_guest("cal_guest_2"), room_type, _day(13), _day(14)).status_code == 201  # check-out day is free

    result = sync_channel_calendar(listing, fetch=_fetcher(_ics()))  # the Airbnb booking was cancelled
    assert result["removed"] == 3 and ChannelBlockedDate.objects.count() == 0


@pytest.mark.django_db
def test_a_calendar_that_cannot_be_read_never_wipes_the_nights_already_blocked(guest_house):
    listing = _connect(guest_house)
    sync_channel_calendar(listing, fetch=_fetcher(_ics((_day(5), _day(7), ""))))

    def broken(channel, url):
        raise CalendarFetchError("The booking site refused the calendar link (error 403).")

    result = sync_channel_calendar(listing, fetch=broken)
    assert not result["ok"] and ChannelBlockedDate.objects.count() == 2
    listing.refresh_from_db()
    assert "403" in listing.last_error


@pytest.mark.django_db
def test_cancelled_events_and_past_nights_are_ignored():
    text = _ics((_day(-3), _day(2), ""), (_day(10), _day(12), "STATUS:CANCELLED\r\n"), (_day(20), _day(20), ""))
    assert parse_busy_nights(text, today=_day(0)) == {_day(0), _day(1), _day(20)}


@pytest.mark.django_db
def test_date_time_events_and_folded_lines_are_understood():
    text = (
        "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20300105T140000Z\r\nDTEND:20300107T110000Z\r\n"
        "SUMMARY:A very long\r\n  summary\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
    )
    from datetime import date
    assert parse_busy_nights(text, today=date(2030, 1, 1)) == {date(2030, 1, 5), date(2030, 1, 6)}


@pytest.mark.django_db
def test_a_night_already_sold_on_oaziland_is_not_overwritten_and_the_owner_is_told_once(guest_house):
    room_type = save_room_type(guest_house, {"name": "Chambre", "capacity": 2, "base_rate_xaf": "20000", "room_count": 1})
    assert _book(_guest("cal_guest_3"), room_type, _day(10), _day(12)).status_code == 201
    listing = _connect(guest_house)
    text = _ics((_day(11), _day(14), ""))

    result = sync_channel_calendar(listing, fetch=_fetcher(text))
    assert result["conflicts"] == [_day(11)]
    assert set(ChannelBlockedDate.objects.values_list("date", flat=True)) == {_day(12), _day(13)}
    assert Notification.objects.filter(recipient=guest_house.owner, notification_type="CHANNEL_CONFLICT").count() == 1
    sync_channel_calendar(listing, fetch=_fetcher(text))
    assert Notification.objects.filter(recipient=guest_house.owner, notification_type="CHANNEL_CONFLICT").count() == 1


@pytest.mark.django_db
def test_the_feed_for_a_channel_has_oaziland_stays_and_other_sites_but_never_its_own_bookings(guest_house):
    room_type = save_room_type(guest_house, {"name": "Chambre", "capacity": 2, "base_rate_xaf": "20000", "room_count": 2})
    assert _book(_guest("cal_guest_4"), room_type, _day(10), _day(12)).status_code == 201
    airbnb = _connect(guest_house)
    booking_com = _connect(guest_house, "BOOKING_COM", "https://admin.booking.com/hotel/hoteladmin/ical.html?t=x")
    sync_channel_calendar(airbnb, fetch=_fetcher(_ics((_day(20), _day(22), ""))))

    to_airbnb, to_booking = render_feed(airbnb), render_feed(booking_com)
    stay_start = f"DTSTART;VALUE=DATE:{_day(10):%Y%m%d}"
    assert "BEGIN:VCALENDAR" in to_airbnb and stay_start in to_airbnb
    assert f"DTSTART;VALUE=DATE:{_day(20):%Y%m%d}" not in to_airbnb  # Airbnb's own booking isn't echoed back
    assert f"DTSTART;VALUE=DATE:{_day(20):%Y%m%d}" in to_booking and f"DTEND;VALUE=DATE:{_day(22):%Y%m%d}" in to_booking
    assert "cal_guest_4" not in to_airbnb  # no guest details leave Oaziland


@pytest.mark.django_db
def test_the_public_feed_needs_the_private_link(guest_house):
    listing = _connect(guest_house)
    client = APIClient()
    ok = client.get(f"/api/calendar/guest-houses/{listing.id}/{listing.export_token}.ics")
    assert ok.status_code == 200 and ok["Content-Type"].startswith("text/calendar") and b"BEGIN:VCALENDAR" in ok.content
    assert client.get(f"/api/calendar/guest-houses/{listing.id}/wrong-token.ics").status_code == 404


@pytest.mark.django_db
def test_only_the_owner_connects_a_site_and_the_link_must_belong_to_it(guest_house):
    url = f"/api/guest-houses/{guest_house.id}/connect-channel/"
    payload = {"channel": "AIRBNB", "calendar_url": AIRBNB_URL}

    assert _client(_guest("cal_stranger")).post(url, payload, format="json").status_code == 403
    owner = _client(guest_house.owner)
    for bad in ("http://www.airbnb.com/calendar/ical/1.ics", "https://evil.example.com/x.ics", "https://169.254.169.254/latest",
                "https://www.airbnb.com.evil.example/cal.ics", "https://user:pw@www.airbnb.com/cal.ics"):
        assert owner.post(url, {**payload, "calendar_url": bad}, format="json").status_code == 400, bad
    assert owner.post(url, {"channel": "DIRECT", "calendar_url": AIRBNB_URL}, format="json").status_code == 400


@pytest.mark.django_db
def test_connecting_reads_the_calendar_at_once_and_disconnecting_frees_the_nights(guest_house, monkeypatch):
    import guest_houses.calendar_sync as sync

    original = sync.sync_channel_calendar
    monkeypatch.setattr(sync, "sync_channel_calendar", lambda listing, **kw: original(listing, fetch=_fetcher(_ics((_day(10), _day(12), ""))), **kw))
    owner = _client(guest_house.owner)
    connected = owner.post(f"/api/guest-houses/{guest_house.id}/connect-channel/", {"channel": "AIRBNB", "calendar_url": AIRBNB_URL}, format="json")
    assert connected.status_code == 200 and connected.data["result"]["added"] == 2
    assert "/api/calendar/guest-houses/" in connected.data["channel"]["feed_url"]
    assert len(owner.get(f"/api/guest-houses/{guest_house.id}/channels/").data) == 1

    assert owner.post(f"/api/guest-houses/{guest_house.id}/disconnect-channel/", {"channel": "AIRBNB"}, format="json").status_code == 204
    assert ChannelBlockedDate.objects.count() == 0 and owner.get(f"/api/guest-houses/{guest_house.id}/channels/").data == []


@pytest.mark.django_db
def test_the_hourly_sweep_keeps_going_when_one_channel_fails(guest_house):
    airbnb = _connect(guest_house)
    _connect(guest_house, "BOOKING_COM", "https://admin.booking.com/hotel/hoteladmin/ical.html?t=x")

    def fetch(channel, url):
        if channel == "BOOKING_COM":
            raise CalendarFetchError("down")
        return _ics((_day(4), _day(5), ""))

    assert sync_all_channel_calendars(fetch=fetch) == {"synced": 1, "failed": 1}
    assert ChannelBlockedDate.objects.filter(source_channel=airbnb.channel).count() == 1


def test_calendar_links_are_checked_before_anything_is_fetched():
    assert validate_calendar_url("AIRBNB", AIRBNB_URL) == AIRBNB_URL
    assert validate_calendar_url("BOOKING_COM", "https://admin.booking.com/hotel/hoteladmin/ical.html?t=1")
    assert validate_calendar_url("EXPEDIA", "https://www.vrbo.com/icalendar/abc.ics")
    for channel, url in (("AIRBNB", "https://admin.booking.com/x.ics"), ("AIRBNB", "https://localhost/x.ics"), ("AIRBNB", "https://www.airbnb.com:8443/x.ics")):
        with pytest.raises(CalendarFetchError):
            validate_calendar_url(channel, url)


class _FakeResponse:
    def __init__(self, status=200, body=b"", location=""):
        self.status_code, self._body, self.headers = status, body, ({"Location": location} if location else {})
        self.is_redirect = 300 <= status < 400

    def iter_content(self, size):
        yield self._body

    def close(self):
        pass


def _public_dns(monkeypatch, address="23.1.2.3"):
    monkeypatch.setattr("guest_houses.ical.socket.getaddrinfo", lambda host, port, **kw: [(2, 1, 6, "", (address, 443))])


def test_a_link_that_resolves_to_a_private_address_is_never_fetched(monkeypatch):
    from guest_houses.ical import fetch_calendar

    _public_dns(monkeypatch, "127.0.0.1")
    monkeypatch.setattr("guest_houses.ical.requests.get", lambda *a, **k: pytest.fail("must not connect"))
    with pytest.raises(CalendarFetchError):
        fetch_calendar("AIRBNB", AIRBNB_URL)


def test_redirects_may_not_leave_the_booking_sites_domain(monkeypatch):
    from guest_houses.ical import fetch_calendar

    _public_dns(monkeypatch)
    calls = []

    def fake_get(url, **kw):
        calls.append(url)
        return _FakeResponse(302, location="https://169.254.169.254/latest/meta-data")

    monkeypatch.setattr("guest_houses.ical.requests.get", fake_get)
    with pytest.raises(CalendarFetchError):
        fetch_calendar("AIRBNB", AIRBNB_URL)
    assert calls == [AIRBNB_URL]


def test_a_good_calendar_is_read_and_a_non_calendar_page_is_refused(monkeypatch):
    from guest_houses.ical import fetch_calendar

    _public_dns(monkeypatch)
    monkeypatch.setattr("guest_houses.ical.requests.get", lambda url, **kw: _FakeResponse(200, b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"))
    assert "BEGIN:VCALENDAR" in fetch_calendar("AIRBNB", AIRBNB_URL)
    monkeypatch.setattr("guest_houses.ical.requests.get", lambda url, **kw: _FakeResponse(200, b"<html>login</html>"))
    with pytest.raises(CalendarFetchError):
        fetch_calendar("AIRBNB", AIRBNB_URL)

@pytest.mark.django_db
def test_rotating_the_link_kills_the_old_one_and_only_the_owner_can_do_it(guest_house):
    listing = _connect(guest_house)
    old = listing.export_token
    url = f"/api/guest-houses/{guest_house.id}/rotate-channel-link/"
    assert _client(_guest("cal_stranger_2")).post(url, {"channel": "AIRBNB"}, format="json").status_code == 403

    rotated = _client(guest_house.owner).post(url, {"channel": "AIRBNB"}, format="json")
    assert rotated.status_code == 200
    listing.refresh_from_db()
    assert listing.export_token != old and listing.export_token in rotated.data["feed_url"]
    anon = APIClient()
    assert anon.get(f"/api/calendar/guest-houses/{listing.id}/{old}.ics").status_code == 404
    assert anon.get(f"/api/calendar/guest-houses/{listing.id}/{listing.export_token}.ics").status_code == 200
    assert _client(guest_house.owner).post(url, {"channel": "EXPEDIA"}, format="json").status_code == 404