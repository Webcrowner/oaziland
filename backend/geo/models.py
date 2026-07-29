"""
geo — the administrative-hierarchy backbone: Country -> Region -> Division ->
Subdivision -> Village/District -> Quarter. This is what turns "search houses
in Bastos" into a fast, indexed query instead of free-text matching.
"""
import uuid
from django.db import models


class Country(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    iso_code = models.CharField(max_length=3, unique=True)

    class Meta:
        db_table = "countries"

    def __str__(self):
        return self.name


class Region(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    country = models.ForeignKey(Country, on_delete=models.CASCADE, related_name="regions")
    name = models.CharField(max_length=100)

    class Meta:
        db_table = "regions"
        unique_together = [("country", "name")]

    def __str__(self):
        return f"{self.name}, {self.country}"


class Division(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    region = models.ForeignKey(Region, on_delete=models.CASCADE, related_name="divisions")
    name = models.CharField(max_length=100)

    class Meta:
        db_table = "divisions"
        unique_together = [("region", "name")]


class Subdivision(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    division = models.ForeignKey(Division, on_delete=models.CASCADE, related_name="subdivisions")
    name = models.CharField(max_length=100)

    class Meta:
        db_table = "subdivisions"
        unique_together = [("division", "name")]


class VillageOrDistrict(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subdivision = models.ForeignKey(
        Subdivision, on_delete=models.CASCADE, related_name="villages_or_districts",
    )
    name = models.CharField(max_length=100)

    class Meta:
        db_table = "villages_or_districts"
        unique_together = [("subdivision", "name")]


class Quarter(models.Model):
    """The neighborhood level — e.g. Bastos, Mvan, Odza, Messassi."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    village_or_district = models.ForeignKey(
        VillageOrDistrict, on_delete=models.CASCADE, related_name="quarters",
    )
    name = models.CharField(max_length=100)

    class Meta:
        db_table = "quarters"
        unique_together = [("village_or_district", "name")]
        indexes = [models.Index(fields=["name"])]

    def __str__(self):
        return self.name


class QuarterPriceTrend(models.Model):
    """Computed rollup, refreshed periodically — not user-editable."""
    quarter = models.ForeignKey(Quarter, on_delete=models.CASCADE, related_name="price_trends")
    period_start = models.DateField()
    period_end = models.DateField()
    avg_price_per_sqm_xaf = models.DecimalField(max_digits=12, decimal_places=2)
    percent_change = models.DecimalField(max_digits=6, decimal_places=2)

    class Meta:
        db_table = "quarter_price_trends"
        indexes = [models.Index(fields=["quarter", "period_end"])]


# ---------------------------------------------------------------------------
# Points of interest — Prompt 3.
#
# WHY one generic model instead of a separate table per amenity type:
# "distance to nearest university" and "distance to nearest market" are
# the SAME underlying question — "how far is this property from the
# closest thing of type X" — just asked about different X values. One
# table with a `poi_type` field answers both, and adding a new amenity
# type later (a stadium, a police station) is a one-line change instead
# of a whole new table and a whole new distance-calculation function.
# ---------------------------------------------------------------------------
class PointOfInterestType(models.TextChoices):
    UNIVERSITY = "UNIVERSITY", "University"
    HOSPITAL = "HOSPITAL", "Hospital"
    MARKET = "MARKET", "Market"
    TRANSPORT_HUB = "TRANSPORT_HUB", "Transport Hub"
    TARRED_ROAD_POINT = "TARRED_ROAD_POINT", "Tarred Road Access Point"


class PointOfInterest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    poi_type = models.CharField(max_length=30, choices=PointOfInterestType.choices)
    quarter = models.ForeignKey(Quarter, on_delete=models.SET_NULL, null=True, blank=True, related_name="points_of_interest")
    latitude = models.DecimalField(max_digits=10, decimal_places=7)
    longitude = models.DecimalField(max_digits=10, decimal_places=7)

    class Meta:
        db_table = "points_of_interest"
        indexes = [models.Index(fields=["poi_type"])]

    def __str__(self):
        return f"{self.name} ({self.get_poi_type_display()})"
