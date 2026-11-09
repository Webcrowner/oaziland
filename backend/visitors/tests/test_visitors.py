from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from identity.models import AdminProfile, User
from visitors import geo
from visitors.models import VisitorEvent
from visitors.services import (
    is_bot, normalise_path, parse_user_agent, referrer_host, visitor_hash,
)

ANDROID_CHROME = (
    "Mozilla/5.0 (Linux; Android 13; Infinix X669) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Mobile Safari/537.36"
)
IPHONE_SAFARI = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.5 Mobile/15E148 Safari/604.1"
)
WINDOWS_EDGE = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0"
)
GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"


@pytest.fixture(autouse=True)
def no_real_geo(monkeypatch):
    """Keep tests off the bundled database unless a test asks for it."""
    monkeypatch.setattr(geo, "from_country_database", lambda ip: geo.GeoInfo())
    monkeypatch.setattr(geo, "from_maxmind", lambda ip: geo.GeoInfo())


def visit(payload=None, ua=ANDROID_CHROME, ip="41.202.219.74", **extra):
    client = APIClient()
    body = {"path": "/en/marketplace"}
    body.update(payload or {})
    return client.post("/api/analytics/visit/", body, format="json", HTTP_USER_AGENT=ua, REMOTE_ADDR=ip, **extra)


# ---------------------------------------------------------------- parsing

@pytest.mark.parametrize("ua, expected", [
    (ANDROID_CHROME, {"device_type": "mobile", "os": "Android", "browser": "Chrome"}),
    (IPHONE_SAFARI, {"device_type": "mobile", "os": "iOS", "browser": "Safari"}),
    (WINDOWS_EDGE, {"device_type": "desktop", "os": "Windows", "browser": "Edge"}),
    ("Mozilla/5.0 (Linux; Android 12; SM-T500) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
     {"device_type": "tablet", "os": "Android", "browser": "Chrome"}),
    ("Mozilla/5.0 (Android 13; Mobile) SamsungBrowser/24.0 Chrome/117.0 Mobile Safari/537.36",
     {"device_type": "mobile", "os": "Android", "browser": "Samsung Internet"}),
    ("Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/100 Mobile Safari/537.36 [FBAN/EMA;FBAV/400]",
     {"device_type": "mobile", "os": "Android", "browser": "Facebook app"}),
    ("Mozilla/5.0 (Mobile; Nokia 8110 4G; rv:84.0) Gecko/84.0 Firefox/84.0 KAIOS/3.1",
     {"device_type": "mobile", "os": "KaiOS", "browser": "Firefox"}),
    ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
     {"device_type": "desktop", "os": "macOS", "browser": "Safari"}),
    ("", {"device_type": "desktop", "os": "Other", "browser": "Other"}),
])
def test_user_agent_parsing(ua, expected):
    assert parse_user_agent(ua) == expected


def test_bots_are_recognised():
    assert is_bot(GOOGLEBOT)
    assert is_bot("curl/8.4.0")
    assert is_bot("")
    assert not is_bot(ANDROID_CHROME)


@pytest.mark.parametrize("raw, expected", [
    ("/en/marketplace?q=secret&token=abc#top", "/marketplace"),
    ("/fr/listing/3f2b8c1a-1111-4222-8333-444455556666", "/listing/:id"),
    ("/en/user/12345/reviews", "/user/:id/reviews"),
    ("/", "/"),
    ("/en", "/"),
    ("/en/admin", ""),
    ("/fr/admin/login", ""),
    ("marketplace", ""),
    (None, ""),
    (123, ""),
])
def test_paths_are_cleaned(raw, expected):
    assert normalise_path(raw) == expected


def test_referrer_host_drops_own_site_and_www():
    assert referrer_host("https://www.google.com/search?q=x") == "google.com"
    assert referrer_host("https://oaziland.com/en", own_host="oaziland.com") == ""
    assert referrer_host("") == ""


def test_visitor_hash_is_stable_within_a_day_and_changes_across_days():
    today = timezone.now()
    assert visitor_hash("1.2.3.4", "UA", today) == visitor_hash("1.2.3.4", "UA", today)
    assert visitor_hash("1.2.3.4", "UA", today) != visitor_hash("1.2.3.5", "UA", today)
    assert visitor_hash("1.2.3.4", "UA", today) != visitor_hash("1.2.3.4", "UA", today + timedelta(days=1))
    assert "1.2.3.4" not in visitor_hash("1.2.3.4", "UA", today)


# ---------------------------------------------------------------- recording

@pytest.mark.django_db
def test_a_visit_is_stored_anonymously_with_device_details():
    res = visit({"locale": "fr", "timezone": "Africa/Douala", "screen_width": 412, "signed_in": True,
                 "referrer": "https://www.google.com/"})

    assert res.status_code == 204
    event = VisitorEvent.objects.get()
    assert event.path == "/marketplace"
    assert (event.device_type, event.os, event.browser) == ("mobile", "Android", "Chrome")
    assert (event.locale, event.timezone, event.screen_width, event.is_signed_in) == ("fr", "Africa/Douala", 412, True)
    assert event.referrer_host == "google.com"
    assert "41.202.219.74" not in str(event.__dict__)


@pytest.mark.django_db
def test_visits_that_should_not_be_counted_are_ignored_but_still_answer_204():
    assert visit(ua=GOOGLEBOT).status_code == 204
    assert visit({"path": "/en/admin"}).status_code == 204
    assert visit(HTTP_DNT="1").status_code == 204
    assert visit(HTTP_SEC_GPC="1").status_code == 204
    assert visit({"path": "no-slash"}).status_code == 204
    assert VisitorEvent.objects.count() == 0


@pytest.mark.django_db
def test_junk_fields_are_dropped_not_stored():
    visit({"locale": "zz", "timezone": "<script>alert(1)</script>", "screen_width": 999999, "signed_in": "yes",
           "referrer": {"not": "a string"}})

    event = VisitorEvent.objects.get()
    assert event.locale == "" and event.timezone == "" and event.screen_width is None
    assert event.is_signed_in is False and event.referrer_host == ""


@pytest.mark.django_db
def test_null_optional_fields_still_count_the_visit():
    res = visit({"referrer": None, "locale": None, "timezone": None, "screen_width": None, "signed_in": None})

    assert res.status_code == 204
    assert VisitorEvent.objects.count() == 1


@pytest.mark.django_db
def test_a_stale_token_does_not_break_tracking():
    res = visit(HTTP_AUTHORIZATION="Bearer not-a-real-token")

    assert res.status_code == 204
    assert VisitorEvent.objects.count() == 1


@pytest.mark.django_db
def test_the_visitor_address_comes_from_the_proxy_header_when_trusted(settings):
    settings.VISITOR_TRUST_FORWARDED_FOR = True
    visit(ip="10.0.0.1", HTTP_X_FORWARDED_FOR="41.202.219.74, 10.0.0.1")
    visit(ip="10.0.0.1", HTTP_X_FORWARDED_FOR="41.202.219.75")
    visit(ip="10.0.0.1", HTTP_X_FORWARDED_FOR="41.202.219.74")

    assert VisitorEvent.objects.values("visitor_hash").distinct().count() == 2


@pytest.mark.django_db
def test_forwarded_headers_are_ignored_when_not_trusted(settings):
    settings.VISITOR_TRUST_FORWARDED_FOR = False
    visit(ip="41.202.219.74", HTTP_X_FORWARDED_FOR="8.8.8.8")
    visit(ip="41.202.219.74", HTTP_X_FORWARDED_FOR="9.9.9.9")

    assert VisitorEvent.objects.values("visitor_hash").distinct().count() == 1


# ---------------------------------------------------------------- location

@pytest.mark.django_db
def test_country_comes_from_the_offline_database(monkeypatch):
    monkeypatch.setattr(geo, "from_country_database", lambda ip: geo.GeoInfo("CM"))

    visit()

    assert VisitorEvent.objects.get().country_code == "CM"


@pytest.mark.django_db
def test_the_bundled_database_really_resolves_a_public_address(monkeypatch):
    monkeypatch.undo()  # use the real database for this one
    visit(ip="8.8.8.8")

    assert VisitorEvent.objects.get().country_code == "US"


@pytest.mark.django_db
def test_cdn_headers_give_country_region_and_city():
    visit(HTTP_CF_IPCOUNTRY="CM", HTTP_CF_REGION="Littoral", HTTP_CF_IPCITY="Douala")

    event = VisitorEvent.objects.get()
    assert (event.country_code, event.region, event.city) == ("CM", "Littoral", "Douala")


@pytest.mark.django_db
def test_cdn_headers_are_ignored_when_forwarding_is_not_trusted(settings):
    settings.VISITOR_TRUST_FORWARDED_FOR = False
    visit(HTTP_CF_IPCOUNTRY="CM", HTTP_CF_IPCITY="Douala")

    assert VisitorEvent.objects.get().city == ""


@pytest.mark.django_db
def test_a_city_database_adds_region_and_city(monkeypatch):
    monkeypatch.setattr(geo, "from_maxmind", lambda ip: geo.GeoInfo("CM", "Centre", "Yaoundé"))

    visit()

    event = VisitorEvent.objects.get()
    assert (event.country_code, event.region, event.city) == ("CM", "Centre", "Yaoundé")


@pytest.mark.django_db
def test_local_addresses_have_no_location():
    visit(ip="127.0.0.1")

    assert VisitorEvent.objects.get().country_code == ""


def test_unknown_cdn_country_codes_are_treated_as_unknown():
    assert geo.from_headers({"HTTP_CF_IPCOUNTRY": "XX"}).country_code == ""
    assert geo.from_headers({"HTTP_CF_IPCOUNTRY": "T1"}).country_code == ""


# ---------------------------------------------------------------- admin summary

def make_admin():
    user = User.objects.create_user(username="visitor_admin", email="va@example.com", phone="+237699300001", password="x-Strong-pass-1")
    AdminProfile.objects.create(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def seed(country, device_ua, path, hours_ago=1, city="", signed_in=False, ip="41.202.219.74", locale="en"):
    event = VisitorEvent.objects.create(
        visitor_hash=f"{country}-{device_ua[:6]}-{ip}", path=path, country_code=country, city=city, locale=locale,
        is_signed_in=signed_in, **parse_user_agent(device_ua),
    )
    VisitorEvent.objects.filter(pk=event.pk).update(created_at=timezone.now() - timedelta(hours=hours_ago))
    return event


@pytest.mark.django_db
def test_summary_is_for_admins_only():
    assert APIClient().get("/api/admin/visitors/").status_code in (401, 403)
    member = User.objects.create_user(username="plain", email="p@example.com", phone="+237699300002", password="x-Strong-pass-1")
    client = APIClient()
    client.force_authenticate(user=member)
    assert client.get("/api/admin/visitors/").status_code == 403


@pytest.mark.django_db
def test_summary_counts_and_breakdowns():
    seed("CM", ANDROID_CHROME, "/marketplace", city="Douala")
    seed("CM", ANDROID_CHROME, "/marketplace", city="Douala")        # same visitor, second page view
    seed("CM", IPHONE_SAFARI, "/listing/:id", city="Yaoundé", ip="41.202.219.80", signed_in=True)
    seed("FR", WINDOWS_EDGE, "/", ip="90.1.2.3", locale="fr")
    seed("US", WINDOWS_EDGE, "/", hours_ago=24 * 20, ip="8.8.8.8")   # outside a 7-day window

    data = make_admin().get("/api/admin/visitors/?days=7").data

    assert data["totals"]["page_views"] == 4
    assert data["totals"]["visitors"] == 3
    assert data["totals"]["pages_per_visitor"] == 1.3
    assert data["totals"]["countries"] == 2
    assert data["totals"]["mobile_share"] == 75
    assert data["totals"]["signed_in_share"] == 25
    assert data["totals"]["location_known_share"] == 100
    assert [row["key"] for row in data["countries"]] == ["CM", "FR"]
    assert data["countries"][0]["visitors"] == 2 and data["countries"][0]["page_views"] == 3
    assert {row["city"] for row in data["cities"]} == {"Douala", "Yaoundé"}
    assert {row["key"]: row["visitors"] for row in data["devices"]} == {"mobile": 2, "desktop": 1}
    assert {row["key"] for row in data["browsers"]} == {"Chrome", "Safari", "Edge"}
    assert data["pages"][0] == {"path": "/marketplace", "page_views": 2, "visitors": 1}
    assert {row["key"] for row in data["languages"]} == {"en", "fr"}
    assert data["has_city_data"] is True
    assert len(data["daily"]) == 7 and sum(day["page_views"] for day in data["daily"]) == 4
    assert len(data["recent"]) == 5
    assert "visitor_hash" not in data["recent"][0]


@pytest.mark.django_db
def test_a_longer_range_includes_older_visits():
    seed("US", WINDOWS_EDGE, "/", hours_ago=24 * 20, ip="8.8.8.8")
    client = make_admin()

    assert client.get("/api/admin/visitors/?days=7").data["totals"]["page_views"] == 0
    assert client.get("/api/admin/visitors/?days=30").data["totals"]["page_views"] == 1


@pytest.mark.django_db
def test_summary_handles_an_empty_database_and_bad_ranges():
    client = make_admin()

    data = client.get("/api/admin/visitors/?days=abc").data

    assert data["range_days"] == 7
    assert data["totals"]["page_views"] == 0 and data["totals"]["pages_per_visitor"] == 0
    assert data["has_city_data"] is False
    assert client.get("/api/admin/visitors/?days=9999").data["range_days"] == 365
    assert client.get("/api/admin/visitors/?days=0").data["range_days"] == 1


@pytest.mark.django_db
def test_online_now_counts_recent_visitors_only():
    seed("CM", ANDROID_CHROME, "/", hours_ago=0)
    seed("FR", WINDOWS_EDGE, "/", hours_ago=3, ip="90.1.2.3")

    assert make_admin().get("/api/admin/visitors/").data["online_now"] == 1


@pytest.mark.django_db
def test_pruning_removes_only_old_rows():
    seed("CM", ANDROID_CHROME, "/", hours_ago=1)
    seed("CM", ANDROID_CHROME, "/old", hours_ago=24 * 200)

    call_command("prune_visitor_events", "--days", "180")

    assert list(VisitorEvent.objects.values_list("path", flat=True)) == ["/"]
