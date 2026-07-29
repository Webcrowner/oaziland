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


class BadgeStatus(models.TextChoices):
    NOT_SUBMITTED = "NOT_SUBMITTED", "Not Submitted"
    PENDING = "PENDING", "Pending Review"
    VERIFIED = "VERIFIED", "Verified"
    REJECTED = "REJECTED", "Rejected"


class Land(PropertyAsset):
    title_deed_number = models.CharField(max_length=100)
    title_type = models.CharField(max_length=20, choices=TitleType.choices)
    boundary_polygon_geojson = models.JSONField(null=True, blank=True)
    bornes_visibles = models.BooleanField(default=False)

    document_badge_status = models.CharField(
        max_length=20, choices=BadgeStatus.choices, default=BadgeStatus.NOT_SUBMITTED,
    )
    document_verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="land_documents_verified",
    )
    document_verified_at = models.DateTimeField(null=True, blank=True)

    site_visit_badge_status = models.CharField(
        max_length=20, choices=BadgeStatus.choices, default=BadgeStatus.NOT_SUBMITTED,
    )
    site_visit_verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="land_site_visits_verified",
    )
    site_visit_verified_at = models.DateTimeField(null=True, blank=True)

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
