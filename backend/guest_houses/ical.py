"""
guest_houses.ical — reading and writing the iCal calendars that Airbnb, Booking.com and Vrbo exchange with hosts.

Fetching a URL a user typed in is a server-side request forgery risk, so fetch_calendar only talks to the channel's
own domains over https, refuses anything that resolves to a private or internal address, and caps the size, time
and number of redirects.
"""
import ipaddress
import re
import socket
from datetime import date, datetime, timedelta
from urllib.parse import urljoin, urlparse

import requests

MAX_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3
TIMEOUT_SECONDS = 10
MAX_NIGHTS = 1500
USER_AGENT = "Oaziland-Calendar-Sync/1.0"

# Each channel's calendar links only ever live on its own domains.
ALLOWED_HOSTS = {
    "AIRBNB": re.compile(r"(^|\.)airbnb\.[a-z]{2,3}(\.[a-z]{2})?$"),
    "BOOKING_COM": re.compile(r"(^|\.)booking\.com$"),
    "EXPEDIA": re.compile(r"(^|\.)(expedia\.com|vrbo\.com|homeaway\.com)$"),
}


class CalendarFetchError(Exception):
    """The calendar couldn't be read; the message is safe to show the owner."""


def validate_calendar_url(channel: str, url: str) -> str:
    pattern = ALLOWED_HOSTS.get(channel)
    if pattern is None:
        raise CalendarFetchError("This channel can't be synced with a calendar link.")
    parsed = urlparse((url or "").strip())
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise CalendarFetchError("Paste the calendar (iCal) link exactly as the site shows it. It must start with https://.")
    if not pattern.search(host):
        raise CalendarFetchError("That link doesn't belong to this booking site. Copy the calendar link from your listing on the site.")
    return parsed.geturl()


def _assert_public(host: str):
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)}
    except socket.gaierror:
        raise CalendarFetchError("We couldn't reach that link.")
    for address in addresses:
        if not ipaddress.ip_address(address).is_global:
            raise CalendarFetchError("That link isn't allowed.")


def fetch_calendar(channel: str, url: str) -> str:
    """The text of a channel's iCal feed."""
    current = validate_calendar_url(channel, url)
    for _ in range(MAX_REDIRECTS + 1):
        _assert_public(urlparse(current).hostname)
        try:
            response = requests.get(
                current, timeout=TIMEOUT_SECONDS, allow_redirects=False, stream=True, headers={"User-Agent": USER_AGENT},
            )
        except requests.RequestException:
            raise CalendarFetchError("We couldn't reach that link. Check it and try again.")
        try:
            if response.is_redirect:
                current = validate_calendar_url(channel, urljoin(current, response.headers.get("Location", "")))
                continue
            if response.status_code != 200:
                raise CalendarFetchError(f"The booking site refused the calendar link (error {response.status_code}). Copy a fresh link from your listing.")
            body = b""
            for chunk in response.iter_content(65536):
                body += chunk
                if len(body) > MAX_BYTES:
                    raise CalendarFetchError("That calendar is too large to read.")
        finally:
            response.close()
        text = body.decode("utf-8", errors="replace")
        if "BEGIN:VCALENDAR" not in text:
            raise CalendarFetchError("That link isn't a calendar (iCal) feed.")
        return text
    raise CalendarFetchError("That link redirects too many times.")


# ---------------------------------------------------------------- reading

def _unfold(text: str) -> list:
    lines = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def _as_date(value: str):
    value = value.strip()
    try:
        if "T" in value:
            return datetime.strptime(value[:15], "%Y%m%dT%H%M%S").date(), datetime.strptime(value[:15], "%Y%m%dT%H%M%S").time()
        return datetime.strptime(value[:8], "%Y%m%d").date(), None
    except ValueError:
        return None, None


def parse_busy_nights(text: str, *, today: date) -> set:
    """Every night from today on that the calendar marks as taken. An event covers its start date up to, but not
    including, its end date (a one-day or same-day event covers that day). Cancelled events are ignored."""
    nights = set()
    event = None
    for line in _unfold(text):
        if line == "BEGIN:VEVENT":
            event = {}
        elif line == "END:VEVENT" and event is not None:
            start, end = event.get("DTSTART"), event.get("DTEND")
            if start and event.get("STATUS", "").upper() != "CANCELLED":
                last = end if end and end > start else start + timedelta(days=1)
                night = max(start, today)
                while night < last and len(nights) < MAX_NIGHTS:
                    nights.add(night)
                    night += timedelta(days=1)
            event = None
        elif event is not None and ":" in line:
            name, _, value = line.partition(":")
            key = name.split(";")[0].upper()
            if key in ("DTSTART", "DTEND"):
                parsed, _time = _as_date(value)
                if parsed:
                    event[key] = parsed
            elif key == "STATUS":
                event["STATUS"] = value.strip()
    return nights


# ---------------------------------------------------------------- writing

def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line: str) -> str:
    out = []
    while len(line.encode("utf-8")) > 74:
        cut = 74
        while len(line[:cut].encode("utf-8")) > 74:
            cut -= 1
        out.append(line[:cut])
        line = " " + line[cut:]
    out.append(line)
    return "\r\n".join(out)


def build_calendar(*, name: str, events: list, now: datetime) -> str:
    """events: (uid, first_night, check_out_date, summary). Whole-day events with no guest details."""
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Oaziland//Channel Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
             f"X-WR-CALNAME:{_escape(name)}"]
    for uid, start, end, summary in events:
        lines += [
            "BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{start.strftime('%Y%m%d')}", f"DTEND;VALUE=DATE:{end.strftime('%Y%m%d')}",
            f"SUMMARY:{_escape(summary)}", "TRANSP:OPAQUE", "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"
