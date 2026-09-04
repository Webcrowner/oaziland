"""
land — the trust/verification layer for Land, absorbed from Terres.cm
(Architecture doc §2.2.1). Land is the highest-fraud-risk asset type, so it
carries verification machinery no other property type needs.
"""
import uuid
from django.conf import settings
from django.db import models
from property.models import PropertyAsset


class TitleType(models.TextChoices):
    TITRE_FONCIER = "TITRE_FONCIER", "Titre Foncier"
    CONCESSION = "CONCESSION", "Concession"
    DEMANDE_EN_COURS = "DEMANDE_EN_COURS", "Demande en Cours"


class LandUseType(models.TextChoices):
    """WHY one enum instead of four separate PropertyAsset subclasses
    (TitledResidentialLand, CommercialPlot, AgriculturalLand,
    CarWashPlot): all four share the EXACT SAME title-deed verification
    machinery below (SecureDocument, CornerPhoto, VerificationBadge) and
    only differ in intended use — a field captures that difference
    without duplicating the trust layer four times."""
    TITLED_RESIDENTIAL = "TITLED_RESIDENTIAL", "Titled Residential"
    COMMERCIAL_PLOT = "COMMERCIAL_PLOT", "Commercial Plot"
    AGRICULTURAL = "AGRICULTURAL", "Agricultural"
    CAR_WASH_PAVED_PLOT = "CAR_WASH_PAVED_PLOT", "Car Wash / Paved Plot"


class Land(PropertyAsset):
    land_use_type = models.CharField(max_length=25, choices=LandUseType.choices, default=LandUseType.TITLED_RESIDENTIAL)
    title_deed_number = models.CharField(max_length=100)
    title_type = models.CharField(max_length=20, choices=TitleType.choices)
    boundary_polygon_geojson = models.JSONField(null=True, blank=True)
    bornes_visibles = models.BooleanField(default=False)  # quick-glance flag; the VerificationBadge is the auditable record

    class Meta:
        db_table = "land_parcels"

    def can_publish(self):
        """A Land listing cannot publish without a title deed number and type
        — this is enforced here, not left to the listing workflow to remember."""
        return bool(self.title_deed_number) and bool(self.title_type)


class SecureDocument(models.Model):
    class DocumentType(models.TextChoices):
        TITLE_DEED = "TITLE_DEED", "Title Deed"
        LOCATION_PLAN = "LOCATION_PLAN", "Location Plan"
        OWNER_ID = "OWNER_ID", "Owner National ID"

    land = models.ForeignKey(Land, on_delete=models.CASCADE, related_name="documents")
    document_type = models.CharField(max_length=20, choices=DocumentType.choices)
    encrypted_file_ref = models.CharField(max_length=255)
    admin_only = models.BooleanField(default=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "secure_documents"


class CornerPhoto(models.Model):
    land = models.ForeignKey(Land, on_delete=models.CASCADE, related_name="corner_photos")
    corner_number = models.PositiveSmallIntegerField()
    file_url = models.URLField()

    class Meta:
        db_table = "corner_photos"


class ScamFlag(models.Model):
    class FlagStatus(models.TextChoices):
        OPEN = "OPEN", "Open"
        REVIEWED = "REVIEWED", "Reviewed"
        DISMISSED = "DISMISSED", "Dismissed"

    land = models.ForeignKey(Land, on_delete=models.CASCADE, related_name="scam_flags")
    reported_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    reason = models.TextField()
    status = models.CharField(max_length=20, choices=FlagStatus.choices, default=FlagStatus.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "scam_flags"


class LandInquiry(models.Model):
    """The 'I Am Looking For Land' reverse board — buyers post their needs,
    owners/agents reach out directly."""
    buyer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    quarter = models.ForeignKey("geo.Quarter", on_delete=models.SET_NULL, null=True)
    min_size_sqm = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    max_budget_xaf = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "land_inquiries"


class LandDueDiligenceReport(models.Model):
    """Combines title status, verification badges, and scam-flag
    history into ONE record for a buyer — the exact three things the
    catalogue document specifies. Kept as its own record (not just a
    computed dict) so a buyer's due-diligence check at a point in time
    can be looked back on later, e.g. if a title dispute arises after
    a sale."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    land = models.ForeignKey(Land, on_delete=models.CASCADE, related_name="due_diligence_reports")
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    title_status_summary = models.JSONField(default=dict)
    verification_summary = models.JSONField(default=dict)
    scam_flag_summary = models.JSONField(default=dict)
    overall_risk_level = models.CharField(max_length=10, blank=True)  # LOW / MEDIUM / HIGH
    generated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "land_due_diligence_reports"
