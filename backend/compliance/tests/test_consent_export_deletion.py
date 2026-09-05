"""
Tests proving Prompt 20's exact acceptance criteria: a real data export
that a user can actually download, and account deletion that correctly
retains financial records while genuinely deleting personal data.
"""
import pytest
import json
from datetime import date
from decimal import Decimal

from identity.models import User, KYCProfile, VerificationStatus
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from transactions.models import Booking, BookingType, BookingStatus
from compliance.models import ConsentType, DataExportRequestStatus, PolicyDocumentType
from compliance.services import (
    record_consent, revoke_consent, has_active_consent, generate_data_export,
    complete_account_deletion, get_current_policy,
)
from engagement.services import request_account_deletion, process_due_account_deletions


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_consent_recorded_and_revocable():
    user = User.objects.create(username="consent_user", phone="+237699999601")

    assert has_active_consent(user=user, consent_type=ConsentType.MARKETING_COMMUNICATIONS) is False
    record_consent(user=user, consent_type=ConsentType.MARKETING_COMMUNICATIONS, version="1.0")
    assert has_active_consent(user=user, consent_type=ConsentType.MARKETING_COMMUNICATIONS) is True

    revoke_consent(user=user, consent_type=ConsentType.MARKETING_COMMUNICATIONS)
    assert has_active_consent(user=user, consent_type=ConsentType.MARKETING_COMMUNICATIONS) is False


@pytest.mark.django_db
def test_consent_is_version_specific():
    user = User.objects.create(username="consent_version_user", phone="+237699999602")
    record_consent(user=user, consent_type=ConsentType.TERMS_OF_SERVICE, version="1.0")

    assert has_active_consent(user=user, consent_type=ConsentType.TERMS_OF_SERVICE, version="1.0") is True
    assert has_active_consent(user=user, consent_type=ConsentType.TERMS_OF_SERVICE, version="2.0") is False


@pytest.mark.django_db
def test_data_export_contains_real_downloadable_data(quarter):
    """The literal acceptance criteria: a test account successfully
    exports its data."""
    user = User.objects.create(username="export_user", phone="+237699999603", email="export@example.com")
    KYCProfile.objects.create(
        user=user, legal_full_name="Export Test User", date_of_birth=date(1990, 5, 15),
        national_id_number="CM-EXPORT-001", residential_address="Bastos, Yaoundé",
        kyc_status=VerificationStatus.VERIFIED,
    )
    landlord = User.objects.create(username="export_landlord", phone="+237699999604")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=user, status=BookingStatus.COMPLETED, amount_xaf=Decimal("100000"), idempotency_key="export-test-1",
    )

    export_request = generate_data_export(user)

    assert export_request.status == DataExportRequestStatus.READY
    assert export_request.export_file.name

    export_request.export_file.open()
    exported_data = json.loads(export_request.export_file.read())
    export_request.export_file.close()

    assert exported_data["profile"]["username"] == "export_user"
    assert exported_data["kyc"]["legal_full_name"] == "Export Test User"
    assert len(exported_data["bookings"]) == 1
    assert exported_data["bookings"][0]["amount_xaf"] == "100000.00"


@pytest.mark.django_db
def test_deletion_retains_financial_records_but_scrubs_personal_data(quarter):
    """The literal acceptance criteria: a test deletion request
    correctly removes what it should while retaining what's legally
    required."""
    user = User.objects.create(username="deletion_test_user", phone="+237699999605", email="delete@example.com", first_name="ToDelete")
    KYCProfile.objects.create(
        user=user, legal_full_name="Deletion Test User", date_of_birth="1990-01-01",
        national_id_number="CM-DELETE-SENSITIVE-001", residential_address="Bastos, Yaoundé",
    )
    landlord = User.objects.create(username="deletion_landlord", phone="+237699999606")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))
    booking = Booking.objects.create(
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing", target_id=listing.id,
        requester=user, status=BookingStatus.COMPLETED, amount_xaf=Decimal("100000"), idempotency_key="deletion-test-1",
    )
    booking_id = booking.id
    user_id = user.id

    complete_account_deletion(user)
    user.refresh_from_db()

    # DELETED: personal identifying data.
    assert user.phone == ""
    assert user.email == ""
    assert user.first_name == ""
    assert user.username == f"deleted_user_{user_id}"
    assert user.deleted_at is not None
    assert hasattr(user, "kyc_profile") is False  # KYC record genuinely gone, not just hidden

    # RETAINED: the financial/legal record, unchanged, still linked.
    booking.refresh_from_db()
    assert booking.id == booking_id
    assert booking.amount_xaf == Decimal("100000")
    assert booking.requester_id == user_id  # still correctly attributed for financial audit purposes


@pytest.mark.django_db
def test_full_deletion_request_workflow_applies_the_real_retention_policy():
    """Confirms process_due_account_deletions (the scheduled job) uses
    the REAL retention-aware deletion, not just a bare deleted_at flag."""
    from datetime import timedelta
    from django.utils import timezone

    user = User.objects.create(username="workflow_deletion_user", phone="+237699999607", email="workflow@example.com")
    KYCProfile.objects.create(user=user, legal_full_name="Workflow User", date_of_birth="1990-01-01", national_id_number="CM-WORKFLOW-001", residential_address="Bastos")

    request_account_deletion(user)
    completed = process_due_account_deletions(now=timezone.now() + timedelta(days=31))

    assert len(completed) == 1
    user.refresh_from_db()
    assert user.email == ""  # genuinely scrubbed, not just flagged
    assert hasattr(user, "kyc_profile") is False


@pytest.mark.django_db
def test_current_policy_document_is_marked_as_an_unreviewed_draft():
    from django.core.management import call_command
    call_command("seed_policy_documents")

    privacy_policy = get_current_policy(PolicyDocumentType.PRIVACY_POLICY)
    assert privacy_policy is not None
    assert "DRAFT" in privacy_policy.body_text
    assert "NOT LEGALLY REVIEWED" in privacy_policy.body_text


@pytest.mark.django_db
def test_community_guidelines_document_reflects_the_real_dance_content_policy():
    from django.core.management import call_command
    call_command("seed_policy_documents")

    guidelines = get_current_policy(PolicyDocumentType.COMMUNITY_GUIDELINES)
    assert guidelines is not None
    assert "not encouraged" in guidelines.body_text
    assert "Dancing" in guidelines.body_text
    assert "never be promoted" in guidelines.body_text
