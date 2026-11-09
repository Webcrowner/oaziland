"""Admins review neighbourhood requests in the console: approve (optionally fixing the spelling) or decline."""
import pytest
from rest_framework.test import APIClient

from geo.models import AreaSuggestion, AreaSuggestionStatus, Quarter, Region
from identity.models import AdminProfile, User
from notifications.models import Notification
from trust_safety.models import AuditLog


@pytest.fixture
def seeded(db):
    from django.core.management import call_command
    call_command("seed_cameroon_geography")


def make_client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def admin(db):
    user = User.objects.create(username="as_admin", phone="+237699860001")
    AdminProfile.objects.create(user=user)
    return user


@pytest.fixture
def lister(db):
    return User.objects.create(username="as_lister", phone="+237699860002", first_name="Lea", last_name="Biya")


def request_area(lister, area="nkol eton", city="Yaoundé", region="Centre"):
    response = make_client(lister).post(
        "/api/area-suggestions/", {"region_name": region, "city_name": city, "area_name": area}, format="json",
    )
    assert response.status_code == 201, response.data
    return AreaSuggestion.objects.get(pk=response.data["id"])


def listing(admin, **params):
    response = make_client(admin).get("/api/admin/area-suggestions/", params)
    assert response.status_code == 200, response.data
    return response.data


def review(admin, suggestion, verb, **body):
    return make_client(admin).post(f"/api/admin/area-suggestions/{suggestion.id}/{verb}/", body, format="json")


@pytest.mark.django_db
def test_a_new_request_alerts_admins(seeded, admin, lister):
    suggestion = request_area(lister)

    alert = Notification.objects.get(recipient=admin, notification_type="AREA_SUGGESTION_REQUESTED")
    assert "nkol eton" in alert.message and alert.related_reference == str(suggestion.id)


@pytest.mark.django_db
def test_only_admins_can_see_or_review_requests(seeded, lister):
    suggestion = request_area(lister)

    assert make_client(lister).get("/api/admin/area-suggestions/").status_code == 403
    assert review(lister, suggestion, "approve").status_code == 403
    assert APIClient().get("/api/admin/area-suggestions/").status_code == 401
    suggestion.refresh_from_db()
    assert suggestion.status == AreaSuggestionStatus.PENDING and not Quarter.objects.filter(name__iexact="nkol eton").exists()


@pytest.mark.django_db
def test_the_queue_shows_pending_by_default_oldest_first_and_can_be_filtered(seeded, admin, lister):
    first = request_area(lister, area="Ekoudou")
    second = request_area(lister, area="Mimboman East")
    review(admin, second, "reject", reason="Not a real area")

    assert [r["id"] for r in listing(admin)["results"]] == [str(first.id)]
    assert [r["id"] for r in listing(admin, status="rejected")["results"]] == [str(second.id)]
    assert listing(admin, status="all")["count"] == 2
    assert listing(admin, q="ekoudou")["count"] == 1
    assert listing(admin, q="as_lister mimboman", status="all")["count"] == 1
    row = listing(admin)["results"][0]
    assert row["requested_by"]["username"] == "as_lister" and row["region_name"] == "Centre"


@pytest.mark.django_db
def test_approving_creates_the_neighbourhood_tells_the_requester_and_is_audited(seeded, admin, lister):
    suggestion = request_area(lister, area="Nkol-Eton")

    response = review(admin, suggestion, "approve")
    assert response.status_code == 200, response.data

    quarter = Quarter.objects.get(name="Nkol-Eton")
    assert quarter.village_or_district.name == "Yaoundé"
    suggestion.refresh_from_db()
    assert suggestion.status == AreaSuggestionStatus.APPROVED and suggestion.created_quarter == quarter
    assert suggestion.reviewed_by == admin and suggestion.reviewed_at is not None
    assert response.data["quarter_name"] == "Nkol-Eton" and response.data["reviewed_by"] == "as_admin"
    assert "Nkol-Eton" in Notification.objects.get(recipient=lister, notification_type="AREA_SUGGESTION").message
    assert Quarter.objects.filter(pk=quarter.pk).exists()
    entry = AuditLog.objects.get(action="admin-area-suggestion/approve")
    assert entry.actor_username == "as_admin" and entry.status_code == 200 and "Nkol-Eton" in entry.target_label
    assert listing(admin)["count"] == 0


@pytest.mark.django_db
def test_the_reviewer_can_fix_the_spelling_before_approving(seeded, admin, lister):
    suggestion = request_area(lister, area="nkol eton", city="yaoundé")

    assert review(admin, suggestion, "approve", area_name="  Nkol-Eton  ", city_name="Yaoundé").status_code == 200

    suggestion.refresh_from_db()
    assert suggestion.area_name == "Nkol-Eton"
    assert Quarter.objects.filter(name="Nkol-Eton").count() == 1
    assert not Quarter.objects.filter(name="nkol eton").exists()


@pytest.mark.django_db
def test_approving_a_new_city_creates_it_and_a_duplicate_name_links_to_the_existing_area(seeded, admin, lister):
    other_city = request_area(lister, area="Centre Ville", city="Ebolowa", region="South")
    review(admin, other_city, "approve")
    assert Quarter.objects.get(name="Centre Ville").village_or_district.name == "Ebolowa"

    bastos = Quarter.objects.get(name="Bastos")
    clash = AreaSuggestion.objects.create(
        suggested_by=lister, region=Region.objects.get(name="Centre"), city_name="Yaoundé", area_name="bastos",
    )
    assert review(admin, clash, "approve").status_code == 200
    clash.refresh_from_db()
    assert clash.created_quarter == bastos and Quarter.objects.filter(name__iexact="bastos").count() == 1


@pytest.mark.django_db
def test_rejecting_needs_a_reason_and_tells_the_requester(seeded, admin, lister):
    suggestion = request_area(lister)

    assert review(admin, suggestion, "reject").status_code == 400
    assert review(admin, suggestion, "reject", reason="   ").status_code == 400
    assert review(admin, suggestion, "reject", reason="x" * 301).status_code == 400
    suggestion.refresh_from_db()
    assert suggestion.status == AreaSuggestionStatus.PENDING

    assert review(admin, suggestion, "reject", reason="That is part of Nkol-Eton already").status_code == 200
    suggestion.refresh_from_db()
    assert suggestion.status == AreaSuggestionStatus.REJECTED and suggestion.reviewed_by == admin
    assert "part of Nkol-Eton" in Notification.objects.get(recipient=lister, notification_type="AREA_SUGGESTION").message
    assert not Quarter.objects.filter(name__iexact="nkol eton").exists()
    assert AuditLog.objects.get(action="admin-area-suggestion/reject", status_code=200).details["reason"].startswith("That is part")
    assert AuditLog.objects.filter(action="admin-area-suggestion/reject", status_code=400).count() == 3


@pytest.mark.django_db
def test_a_reviewed_request_cannot_be_reviewed_again(seeded, admin, lister):
    suggestion = request_area(lister)
    review(admin, suggestion, "approve")

    assert review(admin, suggestion, "approve").status_code == 400
    assert review(admin, suggestion, "reject", reason="Too late").status_code == 400
    assert Notification.objects.filter(recipient=lister, notification_type="AREA_SUGGESTION").count() == 1


@pytest.mark.django_db
def test_bad_names_are_refused(seeded, admin, lister):
    suggestion = request_area(lister)

    assert review(admin, suggestion, "approve", area_name="x" * 101).status_code == 400
    assert review(admin, suggestion, "approve", city_name="y" * 101).status_code == 400
    suggestion.refresh_from_db()
    assert suggestion.status == AreaSuggestionStatus.PENDING


@pytest.mark.django_db
def test_similar_existing_areas_are_shown_for_pending_requests(seeded, admin, lister):
    request_area(lister, area="Bastos Nord", city="Yaoundé")

    row = listing(admin)["results"][0]
    assert "Bastos" in [q["name"] for q in row["similar"]]


@pytest.mark.django_db
def test_the_console_summary_counts_pending_requests(seeded, admin, lister):
    request_area(lister, area="Ekoudou")
    done = request_area(lister, area="Mimboman East")
    review(admin, done, "approve")

    assert make_client(admin).get("/api/admin/console-summary/").data["pending_area_suggestions"] == 1


@pytest.mark.django_db
def test_french_clients_get_french_errors(seeded, admin, lister):
    suggestion = request_area(lister)

    response = make_client(admin).post(
        f"/api/admin/area-suggestions/{suggestion.id}/reject/", {}, format="json", HTTP_ACCEPT_LANGUAGE="fr",
    )
    assert response.status_code == 400 and response.json()["detail"] == "Un motif est requis pour refuser une demande."
