"""
Tests proving the flyer feature actually works end-to-end: a real image
file is generated, and — the strongest possible proof — the QR code
embedded in it is DECODED using a real scanner library and confirmed to
point to the correct URL, for every QR target type the feature supports.
"""
import pytest
import uuid
from PIL import Image
from pyzbar.pyzbar import decode as decode_qr

from identity.models import User
from flyers.models import FlyerCategory, FinishLevel, QrTargetType
from flyers.services import generate_flyer, resolve_qr_target_url


def _decode_flyer_qr(flyer):
    """Opens the actual generated flyer file and scans it with a real
    QR decoder — proving the code is genuinely readable and correct,
    not just that some image bytes were written to disk."""
    flyer.generated_image.open()
    image = Image.open(flyer.generated_image)
    decoded = decode_qr(image)
    flyer.generated_image.close()
    assert len(decoded) == 1, "Expected exactly one scannable QR code in the flyer"
    return decoded[0].data.decode("utf-8")


@pytest.mark.django_db
def test_room_for_rent_flyer_qr_decodes_to_the_correct_listing_url():
    landlord = User.objects.create(username="flyer_landlord", phone="+237699995001")
    listing_id = uuid.uuid4()

    flyer = generate_flyer(
        created_by=landlord, category=FlyerCategory.ROOM_FOR_RENT, finish_level=FinishLevel.MODERN,
        headline_details="Bastos, 25,000 XAF/month", company_name="Glorentech",
        qr_target_type=QrTargetType.SINGLE_LISTING, qr_target_id=listing_id,
    )

    assert flyer.generated_image.name  # a real file was saved
    assert flyer.generated_image.size > 1000  # not an empty/corrupt file

    decoded_url = _decode_flyer_qr(flyer)
    assert decoded_url == f"https://oaziland.com/listing/{listing_id}"
    assert decoded_url == flyer.qr_target_url


@pytest.mark.django_db
def test_land_for_sale_flyer_has_no_finish_level_and_correct_qr():
    """Land has no 'modern/not modern' distinction — finish_level
    should be blank, and the QR still correctly targets the listing."""
    landlord = User.objects.create(username="flyer_landlord_2", phone="+237699995002")
    listing_id = uuid.uuid4()

    flyer = generate_flyer(
        created_by=landlord, category=FlyerCategory.LAND_FOR_SALE,
        headline_details="500 sqm, Titre Foncier, Mbankomo",
        qr_target_type=QrTargetType.SINGLE_LISTING, qr_target_id=listing_id,
    )

    assert flyer.finish_level == ""
    decoded_url = _decode_flyer_qr(flyer)
    assert decoded_url == f"https://oaziland.com/listing/{listing_id}"


@pytest.mark.django_db
def test_agent_profile_flyer_qr_links_to_full_portfolio_not_one_listing():
    """The founder's explicit 'can still be under a particular profile'
    requirement — a flyer can point at an agent's WHOLE portfolio."""
    agent = User.objects.create(username="flyer_agent", phone="+237699995003")

    flyer = generate_flyer(
        created_by=agent, category=FlyerCategory.APARTMENT_FOR_RENT, finish_level=FinishLevel.MODERN,
        headline_details="Multiple units available",
        qr_target_type=QrTargetType.AGENT_PROFILE, qr_target_id=agent.id,
    )

    decoded_url = _decode_flyer_qr(flyer)
    assert decoded_url == f"https://oaziland.com/agent/{agent.id}"
    assert "listing" not in decoded_url  # correctly NOT pointing to a single listing


@pytest.mark.django_db
def test_quarter_search_flyer_qr_links_to_filtered_search():
    """The founder's 'view so many properties according to his search'
    requirement — a flyer can point at a filtered search, not a
    specific property or profile at all."""
    agency_user = User.objects.create(username="flyer_agency", phone="+237699995004")
    quarter_id = uuid.uuid4()

    flyer = generate_flyer(
        created_by=agency_user, category=FlyerCategory.SHOP_FOR_RENT,
        headline_details="Several shops available in this district",
        qr_target_type=QrTargetType.QUARTER_SEARCH, quarter_id=quarter_id,
    )

    decoded_url = _decode_flyer_qr(flyer)
    assert f"quarter={quarter_id}" in decoded_url
    assert "category=SHOP_FOR_RENT" in decoded_url


@pytest.mark.django_db
def test_technician_can_generate_a_flyer_too():
    """The founder explicitly listed technician among who should be
    able to generate these — confirming no role restriction blocks it."""
    from identity.models import TechnicianProfile
    tech_user = User.objects.create(username="flyer_technician", phone="+237699995005")
    TechnicianProfile.objects.create(user=tech_user)

    flyer = generate_flyer(
        created_by=tech_user, category=FlyerCategory.HOUSE_FOR_RENT, finish_level=FinishLevel.STANDARD,
        qr_target_type=QrTargetType.AGENT_PROFILE, qr_target_id=tech_user.id,
    )
    assert flyer.created_by == tech_user


def test_resolve_qr_target_url_rejects_unknown_type():
    with pytest.raises(ValueError):
        resolve_qr_target_url(qr_target_type="NOT_A_REAL_TYPE")
