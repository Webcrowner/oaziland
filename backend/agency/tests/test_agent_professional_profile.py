"""Agents' professional profiles: details, intro video, searchable directory with listing previews, 'See more'."""
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from identity.models import AgentProfile, KYCProfile, User, VerificationStatus
from marketplace.tests.test_marketplace_api import _auth_client
from property.models import House, Listing, ListingStatus, ListingType
from property_management.tests.test_maintenance_leases_safety import quarter  # noqa: F401


def make_agent(username, phone, *, first="", last="", **profile):
    user = User.objects.create(username=username, phone=phone, first_name=first, last_name=last)
    AgentProfile.objects.create(user=user, agent_commission_percent=Decimal("5"), **profile)
    return user


def list_house(agent, quarter, n):
    for i in range(n):
        house = House.objects.create(owner=agent, quarter=quarter, type="HOUSE", description=f"House {i}")
        Listing.objects.create(
            property_asset=house, listed_by=agent, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal(100000 + i),
        )


@pytest.fixture
def video_url(settings):
    return f"{settings.BACKEND_BASE_URL.rstrip('/')}/media/agent-intro/hello.mp4"


@pytest.mark.django_db
def test_an_agent_fills_in_their_profile_and_it_shows_publicly(quarter, video_url):
    agent = make_agent("ap_amina", "+237699540001", first="Amina", last="Ngo")
    body = {
        "bio": "Ten years helping families find homes in Bastos.", "years_experience": 10,
        "specialties": ["RENTALS", "LAND"], "languages": ["FR", "EN"], "areas_served": [str(quarter.pk)],
        "intro_video_url": video_url, "intro_video_seconds": 95,
    }
    saved = _auth_client(agent).patch("/api/my-agent-profile/", body, format="json")
    assert saved.status_code == 200, saved.data
    assert saved.data["specialties"] == ["RENTALS", "LAND"] and saved.data["areas_served"] == [{"id": str(quarter.pk), "name": quarter.name}]

    profile = APIClient().get(f"/api/agents/{agent.pk}/profile/").data
    assert profile["bio"].startswith("Ten years") and profile["years_experience"] == 10
    assert profile["intro_video_url"] == video_url and profile["intro_video_seconds"] == 95

    # Removing the video
    assert _auth_client(agent).patch("/api/my-agent-profile/", {"intro_video_url": ""}, format="json").data["intro_video_url"] == ""


@pytest.mark.django_db
def test_profile_input_is_checked(quarter, video_url):
    agent = make_agent("ap_check", "+237699540002")
    client = _auth_client(agent)
    for bad in (
        {"bio": "x" * 1501}, {"years_experience": 61}, {"years_experience": "ten"}, {"specialties": ["ASTRONAUT"]},
        {"languages": ["KLINGON"]}, {"areas_served": ["00000000-0000-0000-0000-000000000000"]},
        {"intro_video_url": "https://evil.example/v.mp4", "intro_video_seconds": 30},
        {"intro_video_url": video_url, "intro_video_seconds": 301}, {"intro_video_url": video_url},
        {"intro_video_url": video_url.replace("hello", "nudetest"), "intro_video_seconds": 30},
    ):
        assert client.patch("/api/my-agent-profile/", bad, format="json").status_code == 400, bad
    plain = User.objects.create(username="ap_not_agent", phone="+237699540003")
    assert _auth_client(plain).patch("/api/my-agent-profile/", {"bio": "hi"}, format="json").status_code == 403


@pytest.mark.django_db
def test_the_directory_searches_filters_and_previews_three_listings(quarter):
    amina = make_agent("ap_dir_amina", "+237699540011", first="Amina", last="Ngo", specialties=["LAND"], languages=["FR"])
    amina.agent_profile.areas_served.add(quarter)
    KYCProfile.objects.create(
        user=amina, legal_full_name="Amina", date_of_birth="1990-01-01", national_id_number="AP-1", residential_address="x",
        kyc_status=VerificationStatus.VERIFIED,
    )
    make_agent("ap_dir_paul", "+237699540012", first="Paul", last="Eto", specialties=["RENTALS"], languages=["EN"])
    list_house(amina, quarter, 5)

    everyone = APIClient().get("/api/agents/").data
    assert everyone["count"] == 2 and everyone["results"][0]["full_name"] == "Amina Ngo"  # busier agent first
    card = everyone["results"][0]
    assert card["active_listing_count"] == 5 and len(card["listing_preview"]) == 3
    assert card["listing_preview"][0]["path"].startswith("/listing/") and card["is_kyc_verified"] is True

    def names(**params):
        return [row["full_name"] for row in APIClient().get("/api/agents/", params).data["results"]]

    assert names(q="paul") == ["Paul Eto"]
    assert names(q=quarter.name) == ["Amina Ngo"]
    assert names(quarter=str(quarter.pk)) == ["Amina Ngo"]
    assert names(specialty="RENTALS") == ["Paul Eto"]
    assert names(language="FR") == ["Amina Ngo"]
    assert names(verified="1") == ["Amina Ngo"]

    # 'See more' pages through every live listing.
    first = APIClient().get(f"/api/agents/{amina.pk}/listings/", {"limit": 2}).data
    assert first["count"] == 5 and len(first["results"]) == 2 and first["next_offset"] == 2
    last = APIClient().get(f"/api/agents/{amina.pk}/listings/", {"offset": 4, "limit": 2}).data
    assert len(last["results"]) == 1 and last["next_offset"] is None


@pytest.mark.django_db
def test_an_intro_video_can_be_reported_and_a_confirmed_report_removes_it(video_url):
    from identity.models import AdminProfile

    agent = make_agent("ap_video", "+237699540021", intro_video_url=video_url, intro_video_seconds=60)
    viewer = User.objects.create(username="ap_viewer", phone="+237699540022")
    admin = User.objects.create(username="ap_admin", phone="+237699540023")
    AdminProfile.objects.create(user=admin)

    assert _auth_client(agent).post("/api/content-reports/", {"reason": "OTHER", "target_kind": "agent_video", "target_id": str(agent.pk)}, format="json").status_code == 400
    report = _auth_client(viewer).post(
        "/api/content-reports/", {"reason": "INAPPROPRIATE_CONTENT", "target_kind": "agent_video", "target_id": str(agent.pk)}, format="json",
    )
    assert report.status_code == 201, report.data
    assert report.data["target_object_id"] == str(agent.pk)

    resolved = _auth_client(admin).post(
        f"/api/admin/content-reports/{report.data['id']}/resolve/", {"action_taken": "Offensive", "issue_strike": True}, format="json",
    )
    assert resolved.status_code == 200 and resolved.data["target"]["type"] == "agent_video"
    agent.agent_profile.refresh_from_db()
    assert agent.agent_profile.intro_video_url == ""


@pytest.mark.django_db
def test_intro_videos_are_capped_at_300_mb_and_must_be_videos():
    from uploads.services import MediaTooLargeError, UnsupportedMediaTypeError, validate_upload_size

    validate_upload_size(content_type="video/mp4", size_bytes=300 * 1024 * 1024, folder="agent-intro")
    with pytest.raises(MediaTooLargeError):
        validate_upload_size(content_type="video/mp4", size_bytes=300 * 1024 * 1024 + 1, folder="agent-intro")
    with pytest.raises(UnsupportedMediaTypeError):
        validate_upload_size(content_type="image/jpeg", size_bytes=1000, folder="agent-intro")
    validate_upload_size(content_type="video/mp4", size_bytes=400 * 1024 * 1024, folder="videos")  # other folders keep 500 MB
