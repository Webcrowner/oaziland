"""
catalogue.services — subscribing to an amenity and requesting a
partner service, both routing platform fees through the SAME
PlatformFeePolicy mechanism as everything else.
"""


def subscribe_to_amenity(*, amenity, subscriber=None, hostel_unit=None):
    if not subscriber and not hostel_unit:
        raise ValueError("Must provide either subscriber or hostel_unit.")
    from .models import ServiceSubscription
    return ServiceSubscription.objects.create(amenity=amenity, subscriber=subscriber, hostel_unit=hostel_unit)


def request_partner_service(*, offering, requester, notes: str = ""):
    from .models import PartnerServiceRequest
    return PartnerServiceRequest.objects.create(offering=offering, requester=requester, notes=notes)


def complete_partner_service_request(request):
    from django.utils import timezone
    from .models import PartnerServiceRequestStatus
    request.status = PartnerServiceRequestStatus.COMPLETED
    request.completed_at = timezone.now()
    request.save(update_fields=["status", "completed_at"])
    return request
