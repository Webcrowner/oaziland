"""Tests for the Technician Dashboard summary."""
import pytest
from decimal import Decimal

from identity.models import User, TechnicianProfile
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from services.models import ServiceCategory
from services.services import set_technician_specialties, create_service_request, accept_service_request, get_technician_dashboard_summary
from monetization.services import get_or_create_wallet, send_gift, convert_gifts_to_wallet_balance
from monetization.models import GiftType, PlatformFeePolicy, TransactionCategory


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_technician_dashboard_aggregates_real_data(quarter):
    tech_user = User.objects.create(username="dash_tech", phone="+237699993001")
    profile = TechnicianProfile.objects.create(user=tech_user)
    set_technician_specialties(profile, [ServiceCategory.ELECTRICAL])

    homeowner = User.objects.create(username="dash_homeowner", phone="+237699993002")
    request = create_service_request(requester=homeowner, category=ServiceCategory.ELECTRICAL, description="Fix wiring", quarter=quarter)
    accept_service_request(service_request=request, technician=tech_user)

    PlatformFeePolicy.objects.create(category=TransactionCategory.GIFT_CONVERSION, fee_percent=Decimal("5"))
    sender = User.objects.create(username="dash_gift_sender", phone="+237699993003")
    send_gift(sender=sender, recipient=tech_user, gift_type=GiftType.ROSE)
    convert_gifts_to_wallet_balance(user=tech_user)

    summary = get_technician_dashboard_summary(tech_user)
    assert summary["active_job_count"] == 1
    assert summary["completed_job_count"] == 0
    assert summary["wallet_balance_xaf"] > Decimal("0")
