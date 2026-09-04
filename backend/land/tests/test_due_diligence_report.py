"""Tests for the Land Due-Diligence Report aggregation service."""
import pytest
from decimal import Decimal

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from land.models import Land, LandUseType, TitleType, ScamFlag
from land.services import generate_due_diligence_report
from property.models import VerificationBadge, BadgeType


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_clean_verified_land_reports_low_risk(quarter):
    owner = User.objects.create(username="dd_owner_1", phone="+237699991001")
    admin = User.objects.create(username="dd_admin_1", phone="+237699991002")
    buyer = User.objects.create(username="dd_buyer_1", phone="+237699991003")

    land = Land.objects.create(owner=owner, quarter=quarter, type="LAND", land_use_type=LandUseType.TITLED_RESIDENTIAL, title_deed_number="TF-900", title_type=TitleType.TITRE_FONCIER)
    VerificationBadge.objects.create(property_asset=land, badge_type=BadgeType.VERIFIED_DOCUMENT).approve(admin)

    report = generate_due_diligence_report(land=land, requested_by=buyer)
    assert report.overall_risk_level == "LOW"
    assert report.scam_flag_summary["open_flags"] == 0
    assert report.title_status_summary["can_publish"] is True


@pytest.mark.django_db
def test_land_with_open_scam_flag_reports_high_risk(quarter):
    owner = User.objects.create(username="dd_owner_2", phone="+237699991004")
    reporter = User.objects.create(username="dd_reporter", phone="+237699991005")
    land = Land.objects.create(owner=owner, quarter=quarter, type="LAND", land_use_type=LandUseType.TITLED_RESIDENTIAL, title_deed_number="TF-901", title_type=TitleType.TITRE_FONCIER)
    ScamFlag.objects.create(land=land, reported_by=reporter, reason="Seller could not produce original documents")

    report = generate_due_diligence_report(land=land)
    assert report.overall_risk_level == "HIGH"
    assert report.scam_flag_summary["open_flags"] == 1


@pytest.mark.django_db
def test_land_missing_title_deed_reports_high_risk(quarter):
    owner = User.objects.create(username="dd_owner_3", phone="+237699991006")
    land = Land.objects.create(owner=owner, quarter=quarter, type="LAND", land_use_type=LandUseType.AGRICULTURAL, title_deed_number="", title_type=TitleType.DEMANDE_EN_COURS)

    report = generate_due_diligence_report(land=land)
    assert report.overall_risk_level == "HIGH"


@pytest.mark.django_db
def test_land_with_no_badges_yet_reports_medium_risk(quarter):
    owner = User.objects.create(username="dd_owner_4", phone="+237699991007")
    land = Land.objects.create(owner=owner, quarter=quarter, type="LAND", land_use_type=LandUseType.COMMERCIAL_PLOT, title_deed_number="TF-902", title_type=TitleType.CONCESSION)

    report = generate_due_diligence_report(land=land)
    assert report.overall_risk_level == "MEDIUM"  # has a valid title deed, but nothing verified yet
