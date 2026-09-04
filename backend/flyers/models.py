"""
flyers — printable property advertisement generation, the digital
replacement for the paper "TO LET" signs commonly posted on walls and
poles in Cameroon. A landlord, agent, agency, or technician can
generate a flyer carrying the company/agency logo and a scannable QR
code linking back to the platform.
"""
import uuid
from django.conf import settings
from django.db import models


class FlyerCategory(models.TextChoices):
    """The headline categories a physical flyer would advertise —
    deliberately matching how these are actually described on real
    walls in Cameroon ('Chambre à Louer', 'Terrain à Vendre'), not the
    more granular internal PropertyAsset subtype names."""
    ROOM_FOR_RENT = "ROOM_FOR_RENT", "Room for Rent"
    STUDIO_FOR_RENT = "STUDIO_FOR_RENT", "Studio for Rent"
    APARTMENT_FOR_RENT = "APARTMENT_FOR_RENT", "Apartment for Rent"
    HOUSE_FOR_RENT = "HOUSE_FOR_RENT", "House for Rent"
    HOUSE_FOR_SALE = "HOUSE_FOR_SALE", "House for Sale"
    PLOT_FOR_SALE = "PLOT_FOR_SALE", "Plot for Sale"
    LAND_FOR_SALE = "LAND_FOR_SALE", "Land for Sale"
    SHOP_FOR_RENT = "SHOP_FOR_RENT", "Shop for Rent"
    OFFICE_FOR_RENT = "OFFICE_FOR_RENT", "Office for Rent"


class FinishLevel(models.TextChoices):
    """WHY optional: 'modern or not modern' matters for a house/room/
    apartment (a real distinction Cameroonian renters ask about
    immediately) but is meaningless for a plot of land."""
    MODERN = "MODERN", "Modern"
    STANDARD = "STANDARD", "Standard (Not Modern)"


class QrTargetType(models.TextChoices):
    """WHERE the QR code sends the scanner — 'view so many properties
    according to his search' means the QR doesn't always have to point
    at ONE listing; it can point at an agent/agency's full portfolio,
    or a pre-filtered search."""
    SINGLE_LISTING = "SINGLE_LISTING", "This Specific Listing"
    AGENT_PROFILE = "AGENT_PROFILE", "Agent's Full Portfolio"
    AGENCY_PROFILE = "AGENCY_PROFILE", "Agency's Full Portfolio"
    QUARTER_SEARCH = "QUARTER_SEARCH", "Search Results for This Quarter & Category"


class Flyer(models.Model):
    """One generated, printable flyer. generated_image is a REAL
    composed PNG (logo + headline + details + QR code), not a template
    reference — created_by can download and actually print it."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="flyers_created")
    category = models.CharField(max_length=25, choices=FlyerCategory.choices)
    finish_level = models.CharField(max_length=10, choices=FinishLevel.choices, blank=True)
    headline_details = models.CharField(max_length=200, blank=True)  # e.g. "2 Bedrooms, Bastos, 100,000 XAF/month"
    company_name = models.CharField(max_length=200, default="Oaziland")
    logo_url = models.URLField(blank=True)
    qr_target_type = models.CharField(max_length=20, choices=QrTargetType.choices)
    qr_target_id = models.UUIDField(null=True, blank=True)  # a listing_id, agent user id, agency id, or quarter id depending on qr_target_type
    qr_target_url = models.URLField()  # the actual resolved URL encoded in the QR
    generated_image = models.FileField(upload_to="flyers/")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "flyers"
