"""
Tests proving BlockchainVerificationService actually provides tamper
evidence — not just stores hashes that nothing ever checks.
"""
import pytest
from decimal import Decimal

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from land.models import Land, LandUseType, TitleType
from property.models import VerificationBadge, BadgeType
from verification_audit.models import BlockchainAnchorRecord, AnchorSubjectType
from verification_audit.services import (
    anchor_document, verify_document_against_anchor, verify_chain_integrity,
    anchor_verification_badge_approval, compute_document_hash,
)


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_document_verifies_correctly_against_its_own_anchor(quarter):
    landlord = User.objects.create(username="anchor_landlord", phone="+237699900001")
    land = Land.objects.create(owner=landlord, quarter=quarter, type="LAND", land_use_type=LandUseType.TITLED_RESIDENTIAL, title_deed_number="TF-500", title_type=TitleType.TITRE_FONCIER)

    title_deed_pdf_bytes = b"This is the content of a title deed document."
    record = anchor_document(subject=land, subject_type=AnchorSubjectType.TITLE_DEED, document_content=title_deed_pdf_bytes, anchored_by=landlord)

    assert verify_document_against_anchor(anchor_record=record, document_content=title_deed_pdf_bytes) is True


@pytest.mark.django_db
def test_altered_document_fails_verification(quarter):
    """The entire point of this feature — an altered document must NOT
    verify against the original anchor."""
    landlord = User.objects.create(username="anchor_landlord_2", phone="+237699900002")
    land = Land.objects.create(owner=landlord, quarter=quarter, type="LAND", land_use_type=LandUseType.TITLED_RESIDENTIAL, title_deed_number="TF-501", title_type=TitleType.TITRE_FONCIER)

    original_content = b"Title deed: 500 sqm parcel, TF-501, owner Jean Doe."
    tampered_content = b"Title deed: 5000 sqm parcel, TF-501, owner Jean Doe."  # size quietly altered

    record = anchor_document(subject=land, subject_type=AnchorSubjectType.TITLE_DEED, document_content=original_content, anchored_by=landlord)

    assert verify_document_against_anchor(anchor_record=record, document_content=original_content) is True
    assert verify_document_against_anchor(anchor_record=record, document_content=tampered_content) is False


@pytest.mark.django_db
def test_chain_integrity_holds_across_multiple_anchors(quarter):
    landlord = User.objects.create(username="anchor_landlord_3", phone="+237699900003")
    land_a = Land.objects.create(owner=landlord, quarter=quarter, type="LAND", land_use_type=LandUseType.TITLED_RESIDENTIAL, title_deed_number="TF-502", title_type=TitleType.TITRE_FONCIER)
    land_b = Land.objects.create(owner=landlord, quarter=quarter, type="LAND", land_use_type=LandUseType.COMMERCIAL_PLOT, title_deed_number="TF-503", title_type=TitleType.CONCESSION)

    record_1 = anchor_document(subject=land_a, subject_type=AnchorSubjectType.TITLE_DEED, document_content=b"Deed A content", anchored_by=landlord)
    record_2 = anchor_document(subject=land_b, subject_type=AnchorSubjectType.TITLE_DEED, document_content=b"Deed B content", anchored_by=landlord)

    # Each record correctly chains to the previous one.
    assert record_1.previous_record_hash == ""  # first record in the chain
    assert record_2.previous_record_hash == record_1.chain_record_hash

    assert verify_chain_integrity() is True


@pytest.mark.django_db
def test_tampering_with_a_past_record_breaks_chain_integrity(quarter):
    """Proves the tamper-evidence actually works across the WHOLE
    chain, not just for a single record in isolation — altering an
    early record must invalidate every later one's verifiability."""
    landlord = User.objects.create(username="anchor_landlord_4", phone="+237699900004")
    land_a = Land.objects.create(owner=landlord, quarter=quarter, type="LAND", land_use_type=LandUseType.TITLED_RESIDENTIAL, title_deed_number="TF-504", title_type=TitleType.TITRE_FONCIER)
    land_b = Land.objects.create(owner=landlord, quarter=quarter, type="LAND", land_use_type=LandUseType.AGRICULTURAL, title_deed_number="TF-505", title_type=TitleType.DEMANDE_EN_COURS)

    record_1 = anchor_document(subject=land_a, subject_type=AnchorSubjectType.TITLE_DEED, document_content=b"Original deed A", anchored_by=landlord)
    anchor_document(subject=land_b, subject_type=AnchorSubjectType.TITLE_DEED, document_content=b"Deed B content", anchored_by=landlord)

    assert verify_chain_integrity() is True

    # Simulate someone tampering directly with the FIRST record's stored hash.
    record_1.document_hash = compute_document_hash(b"A maliciously altered deed A")
    record_1.save(update_fields=["document_hash"])

    assert verify_chain_integrity() is False  # correctly detected, even though only record_1 was touched


@pytest.mark.django_db
def test_anchor_composes_onto_verification_badge_without_modifying_it(quarter):
    """Confirms this is a COMPOSED layer — VerificationBadge itself is
    untouched, the anchor just references it."""
    landlord = User.objects.create(username="anchor_landlord_5", phone="+237699900005")
    admin = User.objects.create(username="anchor_admin", phone="+237699900006")
    land = Land.objects.create(owner=landlord, quarter=quarter, type="LAND", land_use_type=LandUseType.TITLED_RESIDENTIAL, title_deed_number="TF-506", title_type=TitleType.TITRE_FONCIER)

    badge = VerificationBadge.objects.create(property_asset=land, badge_type=BadgeType.VERIFIED_DOCUMENT)
    badge.approve(admin)  # existing, unmodified VerificationBadge.approve() method

    anchor = anchor_verification_badge_approval(badge=badge, document_content=b"The approved title deed scan")

    assert anchor.subject_type == AnchorSubjectType.VERIFICATION_BADGE
    assert anchor.anchored_by == admin  # taken from badge.verified_by, set by the existing approve() method
    # VerificationBadge itself has no new fields — confirming composition, not modification.
    assert not hasattr(badge, "blockchain_anchor")
