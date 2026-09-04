"""
discovery — saved searches with automatic alerts, side-by-side property
comparison, and photo-based visual search. Ties every property type and
the recommendation engine together into one discovery layer.
"""
import uuid
from django.conf import settings
from django.db import models


class SavedSearch(models.Model):
    """A user's stored search criteria — e.g. '2BR under 100,000 XAF in
    Bastos'. WHY filters is a JSONField rather than individual columns:
    the set of filterable attributes (price, bedrooms, quarter, zoning,
    utilities, road type, distance to a point-of-interest type) keeps
    growing across prompts — a flexible filter dict avoids a schema
    migration every time a new filterable field is added elsewhere."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="saved_searches")
    name = models.CharField(max_length=200, blank=True)  # e.g. a user-given label
    filters = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    last_notified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "saved_searches"


class PropertyComparison(models.Model):
    """Side-by-side comparison of 2-4 shortlisted listings. WHY a max of
    4 is enforced in services.py rather than here: Django model fields
    can't easily cap a JSONField list's length at the database level —
    the real enforcement lives in the function that creates/updates one."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="property_comparisons")
    listing_ids = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "property_comparisons"


class VisualSearchQuery(models.Model):
    """A record of one 'find listings that look like this photo' search —
    kept as its own table (not just a stateless API call) so search
    history and result quality can be reviewed/improved over time."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="visual_search_queries")
    uploaded_image_url = models.URLField()
    matched_listing_ids = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "visual_search_queries"


class ListingWaitlistEntry(models.Model):
    """WHY this is separate from student_hostels.Waitlist: that one is
    scoped specifically to hostel unit types within one hostel/semester.
    This is the GENERAL-PURPOSE version — anyone can join a waitlist for
    ANY property.Listing that's currently taken, and gets notified the
    moment it becomes available again."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="listing_waitlist_entries")
    listing_id = models.UUIDField()
    joined_at = models.DateTimeField(auto_now_add=True)
    notified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "listing_waitlist_entries"
        unique_together = [("user", "listing_id")]
