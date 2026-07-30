"""
agency — agency-specific operational features that are NOT identity
concerns: enquiry/response tracking (for performance scoring), and the
services that compute commission splits and agent/agency performance.

AgencyProfile and AgentProfile themselves stay in `identity` (they're
Role attachments to a User); AgencyBenefit stays in `monetization` (it's
part of the platform's value-proposition/monetization story). This app
is deliberately just the operational layer on top of those.
"""
import uuid
from django.conf import settings
from django.db import models


class Enquiry(models.Model):
    """A prospective client's enquiry about a listing, directed at a
    specific agent. WHY a dedicated model instead of reusing the generic
    InteractionLog: InteractionLog is a free-text CRM note written AFTER
    the fact; Enquiry exists specifically to measure RESPONSE TIME —
    it's created the moment a client reaches out, and first_response_at
    is set the moment the agent actually replies. That's a narrower,
    more precise purpose than a general conversation log."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="enquiries_sent")
    agent = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="enquiries_received")
    listing_id = models.UUIDField(null=True, blank=True)
    message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    first_response_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "agency_enquiries"
        indexes = [models.Index(fields=["agent", "created_at"])]

    def respond(self):
        """Records the moment an agent's first reply happened. Only the
        FIRST response counts — calling this again on an already-answered
        enquiry does nothing, so an agent can't inflate their score by
        re-triggering this on old enquiries."""
        if self.first_response_at is None:
            from django.utils import timezone
            self.first_response_at = timezone.now()
            self.save(update_fields=["first_response_at"])

    @property
    def response_time_seconds(self):
        if self.first_response_at is None:
            return None
        return (self.first_response_at - self.created_at).total_seconds()
