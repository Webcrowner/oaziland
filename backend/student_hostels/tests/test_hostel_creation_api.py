"""
Tests for real StudentHostel creation and photos — closing a genuine
gap: StudentHostelViewSet was ReadOnlyModelViewSet, meaning no real
owner could ever list their own hostel.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from student_hostels.models import StudentHostel, OwnerProfile


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Ngoa-Ekelle")
    return Quarter.objects.create(village_or_district=village, name="Ngoa-Ekelle Campus")


@pytest.mark.django_db
def test_creating_a_real_student_hostel_auto_provisions_a_real_owner_profile(quarter):
    """The exact same real gap already found and fixed for
    marketplace listings — verified directly that a real OwnerProfile
    now exists, not just assumed from reading the view."""
    owner = User.objects.create(username="sh_create_owner", phone="+237699999901")
    assert OwnerProfile.objects.filter(account_user=owner).exists() is False
    client = _auth_client(owner)

    response = client.post("/api/student-hostels/", {"quarter": str(quarter.id), "property_type": "BLOCK"})

    assert response.status_code == 201
    assert OwnerProfile.objects.filter(account_user=owner).exists() is True
    hostel = StudentHostel.objects.get(id=response.data["id"])
    assert hostel.owner_id == owner.id
    assert hostel.owner_profile.account_user_id == owner.id


@pytest.mark.django_db
def test_a_new_student_hostel_is_immediately_publicly_visible(quarter):
    owner = User.objects.create(username="sh_visibility_owner", phone="+237699999902")
    _auth_client(owner).post("/api/student-hostels/", {"quarter": str(quarter.id)})

    response = APIClient().get("/api/student-hostels/")

    assert response.data["count"] == 1


@pytest.mark.django_db
def test_adding_a_real_photo_to_a_student_hostel(quarter):
    owner = User.objects.create(username="sh_photo_owner", phone="+237699999903")
    client = _auth_client(owner)
    create_response = client.post("/api/student-hostels/", {"quarter": str(quarter.id)})
    hostel_id = create_response.data["id"]

    photo_response = client.post(f"/api/student-hostels/{hostel_id}/add-photo/", {"url": "https://example.com/hostel1.jpg"})

    assert photo_response.status_code == 201
    detail = client.get(f"/api/student-hostels/{hostel_id}/")
    assert len(detail.data["photos"]) == 1


@pytest.mark.django_db
def test_only_the_hostels_own_owner_can_add_a_photo(quarter):
    owner = User.objects.create(username="sh_photo_perm_owner", phone="+237699999904")
    stranger = User.objects.create(username="sh_photo_perm_stranger", phone="+237699999905")
    create_response = _auth_client(owner).post("/api/student-hostels/", {"quarter": str(quarter.id)})
    hostel_id = create_response.data["id"]

    response = _auth_client(stranger).post(f"/api/student-hostels/{hostel_id}/add-photo/", {"url": "https://example.com/hijack.jpg"})

    assert response.status_code == 403


@pytest.mark.django_db
def test_creating_a_student_hostel_requires_authentication(quarter):
    response = APIClient().post("/api/student-hostels/", {"quarter": str(quarter.id)})
    assert response.status_code == 401
