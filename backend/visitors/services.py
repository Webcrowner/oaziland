"""
visitors.services — turning a page-view ping into an anonymous VisitorEvent, and
turning stored events into the numbers the admin console shows.
"""
import hashlib
import hmac
import ipaddress
import re
from datetime import timedelta
from urllib.parse import urlparse

from django.conf import settings
from django.db.models import Count
from django.db.models.functions import TruncDate
from django.utils import timezone

from . import geo
from .models import VisitorEvent

# ---------------------------------------------------------------- user agent

_BOT_PATTERN = re.compile(
    r"bot\b|bot/|crawl|spider|slurp|facebookexternalhit|headless|lighthouse|pingdom|uptimerobot|"
    r"python-requests|python-urllib|curl/|wget/|go-http-client|node-fetch|axios/|httpclient",
    re.IGNORECASE,
)

_BROWSERS = (
    ("Facebook app", re.compile(r"fban|fbav|fb_iab", re.I)),
    ("Instagram app", re.compile(r"instagram", re.I)),
    ("TikTok app", re.compile(r"musical_ly|bytedancewebview|tiktok", re.I)),
    ("Edge", re.compile(r"edg(?:e|a|ios)?/", re.I)),
    ("Opera", re.compile(r"opr/|opera", re.I)),
    ("Samsung Internet", re.compile(r"samsungbrowser", re.I)),
    ("UC Browser", re.compile(r"ucbrowser|ucweb", re.I)),
    ("Firefox", re.compile(r"firefox|fxios", re.I)),
    ("Chrome", re.compile(r"chrome|crios|chromium", re.I)),
    ("Safari", re.compile(r"safari", re.I)),
    ("Internet Explorer", re.compile(r"msie|trident", re.I)),
)


def is_bot(user_agent: str) -> bool:
    return not user_agent or bool(_BOT_PATTERN.search(user_agent))


def parse_user_agent(user_agent: str) -> dict:
    """Device type, operating system and browser from a User-Agent string."""
    ua = (user_agent or "")
    lower = ua.lower()

    if "windows phone" in lower:
        os_name = "Windows Phone"
    elif "kaios" in lower:
        os_name = "KaiOS"
    elif "android" in lower:
        os_name = "Android"
    elif re.search(r"iphone|ipad|ipod", lower):
        os_name = "iOS"
    elif "cros" in lower:
        os_name = "ChromeOS"
    elif "windows" in lower:
        os_name = "Windows"
    elif "mac os x" in lower or "macintosh" in lower:
        os_name = "macOS"
    elif "linux" in lower or "x11" in lower:
        os_name = "Linux"
    else:
        os_name = "Other"

    if "ipad" in lower or "tablet" in lower or ("android" in lower and "mobile" not in lower):
        device = "tablet"
    elif "mobi" in lower or "iphone" in lower or "ipod" in lower or "kaios" in lower or "android" in lower:
        device = "mobile"
    else:
        device = "desktop"

    browser = "Other"
    for name, pattern in _BROWSERS:
        if pattern.search(ua):
            browser = name
            break
    return {"device_type": device, "os": os_name, "browser": browser}


# ---------------------------------------------------------------- request parts

def client_ip(request) -> str:
    """The visitor's address. Behind a proxy/CDN the real client is in a forwarded header."""
    meta = request.META
    candidate = meta.get("REMOTE_ADDR", "")
    if getattr(settings, "VISITOR_TRUST_FORWARDED_FOR", True):
        forwarded = meta.get("HTTP_CF_CONNECTING_IP") or (meta.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip())
        if forwarded:
            candidate = forwarded
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return ""


def visitor_hash(ip: str, user_agent: str, when=None) -> str:
    """Counts a visitor within one day. The key changes daily, so it cannot be followed across days."""
    day = (when or timezone.now()).strftime("%Y-%m-%d")
    key = hmac.new(settings.SECRET_KEY.encode(), f"visitors:{day}".encode(), hashlib.sha256).digest()
    return hmac.new(key, f"{ip}|{user_agent}".encode(), hashlib.sha256).hexdigest()[:32]


_ID_SEGMENT = re.compile(
    r"^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{2,})$", re.IGNORECASE
)


def normalise_path(raw) -> str:
    """A page path without its query string, with ids collapsed so /listing/<uuid> groups together.
    Returns "" for anything that should not be tracked (admin pages, junk)."""
    if not isinstance(raw, str):
        return ""
    path = raw.split("?", 1)[0].split("#", 1)[0].strip()
    if not path.startswith("/"):
        return ""
    segments = [":id" if _ID_SEGMENT.match(s) else s for s in path.split("/") if s]
    if segments and segments[0] in ("en", "fr"):
        segments = segments[1:]
    if segments and segments[0] == "admin":
        return ""
    return ("/" + "/".join(segments))[:200]


def referrer_host(raw, own_host: str = "") -> str:
    if not isinstance(raw, str) or not raw:
        return ""
    host = (urlparse(raw).hostname or "").lower()
    host = host[4:] if host.startswith("www.") else host
    own = (own_host or "").lower()
    own = own[4:] if own.startswith("www.") else own
    return "" if not host or host == own else host[:100]


_TIMEZONE = re.compile(r"^[A-Za-z_]+(?:/[A-Za-z0-9_+\-]+){0,2}$")


def record_visit(request, payload: dict):
    """Stores one anonymous page view. Returns the event, or None when it should not be counted
    (a bot, the admin console, or a visitor who sent Do Not Track / Global Privacy Control)."""
    meta = request.META
    if meta.get("HTTP_DNT") == "1" or meta.get("HTTP_SEC_GPC") == "1":
        return None
    user_agent = meta.get("HTTP_USER_AGENT", "")[:400]
    if is_bot(user_agent):
        return None
    path = normalise_path(payload.get("path"))
    if not path:
        return None

    ip = client_ip(request)
    location = geo.locate(ip, meta) if ip else geo.GeoInfo()
    own_host = urlparse(meta.get("HTTP_ORIGIN", "")).hostname or ""

    locale = payload.get("locale")
    tz = payload.get("timezone")
    width = payload.get("screen_width")
    return VisitorEvent.objects.create(
        visitor_hash=visitor_hash(ip, user_agent),
        path=path,
        locale=locale if locale in ("en", "fr") else "",
        referrer_host=referrer_host(payload.get("referrer"), own_host),
        country_code=location.country_code,
        region=location.region,
        city=location.city,
        timezone=tz[:64] if isinstance(tz, str) and _TIMEZONE.match(tz) else "",
        screen_width=width if isinstance(width, int) and not isinstance(width, bool) and 0 < width < 10000 else None,
        is_signed_in=payload.get("signed_in") is True,
        **parse_user_agent(user_agent),
    )


# ---------------------------------------------------------------- reporting

ONLINE_WINDOW_MINUTES = 5


def _breakdown(events, field, limit=10):
    rows = (
        events.values(field)
        .annotate(page_views=Count("id"), visitors=Count("visitor_hash", distinct=True))
        .order_by("-visitors", "-page_views")[:limit]
    )
    return [{"key": row[field], "page_views": row["page_views"], "visitors": row["visitors"]} for row in rows]


def build_summary(days: int) -> dict:
    now = timezone.now()
    since = now - timedelta(days=days)
    events = VisitorEvent.objects.filter(created_at__gte=since)

    page_views = events.count()
    visitors = events.values("visitor_hash").distinct().count()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today = VisitorEvent.objects.filter(created_at__gte=today_start)
    online = VisitorEvent.objects.filter(created_at__gte=now - timedelta(minutes=ONLINE_WINDOW_MINUTES))

    per_day = {
        row["day"]: row
        for row in events.annotate(day=TruncDate("created_at")).values("day")
        .annotate(page_views=Count("id"), visitors=Count("visitor_hash", distinct=True))
    }
    daily = []
    for offset in range(days - 1, -1, -1):
        day = (now - timedelta(days=offset)).date()
        row = per_day.get(day)
        daily.append({"date": day.isoformat(), "page_views": row["page_views"] if row else 0, "visitors": row["visitors"] if row else 0})

    cities = (
        events.exclude(city="")
        .values("city", "region", "country_code")
        .annotate(page_views=Count("id"), visitors=Count("visitor_hash", distinct=True))
        .order_by("-visitors", "-page_views")[:10]
    )
    countries = _breakdown(events.exclude(country_code=""), "country_code")
    known_country_views = events.exclude(country_code="").count()
    mobile_views = events.filter(device_type__in=("mobile", "tablet")).count()
    signed_in_views = events.filter(is_signed_in=True).count()

    recent = list(
        VisitorEvent.objects.order_by("-created_at")[:25].values(
            "created_at", "country_code", "region", "city", "device_type", "os", "browser", "path", "locale", "is_signed_in",
        )
    )

    return {
        "range_days": days,
        "totals": {
            "page_views": page_views,
            "visitors": visitors,
            "pages_per_visitor": round(page_views / visitors, 1) if visitors else 0,
            "countries": events.exclude(country_code="").values("country_code").distinct().count(),
            "mobile_share": round(100 * mobile_views / page_views) if page_views else 0,
            "signed_in_share": round(100 * signed_in_views / page_views) if page_views else 0,
            "location_known_share": round(100 * known_country_views / page_views) if page_views else 0,
        },
        "today": {"page_views": today.count(), "visitors": today.values("visitor_hash").distinct().count()},
        "online_now": online.values("visitor_hash").distinct().count(),
        "daily": daily,
        "countries": countries,
        "cities": [
            {"city": c["city"], "region": c["region"], "country_code": c["country_code"], "page_views": c["page_views"], "visitors": c["visitors"]}
            for c in cities
        ],
        "devices": _breakdown(events.exclude(device_type=""), "device_type"),
        "browsers": _breakdown(events.exclude(browser=""), "browser"),
        "operating_systems": _breakdown(events.exclude(os=""), "os"),
        "languages": _breakdown(events.exclude(locale=""), "locale"),
        "timezones": _breakdown(events.exclude(timezone=""), "timezone", limit=6),
        "pages": [
            {"path": row["path"], "page_views": row["page_views"], "visitors": row["visitors"]}
            for row in events.values("path")
            .annotate(page_views=Count("id"), visitors=Count("visitor_hash", distinct=True))
            .order_by("-page_views")[:10]
        ],
        "referrers": _breakdown(events.exclude(referrer_host=""), "referrer_host"),
        "recent": recent,
        "has_city_data": events.exclude(city="").exists(),
        "retention_days": settings.VISITOR_RETENTION_DAYS,
    }
