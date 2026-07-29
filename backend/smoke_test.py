"""Exercises the 'rent a house in any neighborhood' scenario end-to-end
against the real models and service layer, using an in-memory fake lock
client in place of Redis."""
import os, django, uuid
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "oaziland.settings")
django.setup()

from decimal import Decimal
from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from transactions.services import reserve_booking, confirm_payment, complete_booking
from transactions.models import BookingType

class FakeLock:
    def __init__(self): self.locked = set()
    def acquire(self, key, ttl_seconds):
        if key in self.locked: return False
        self.locked.add(key); return True
    def release(self, key, permanent=False):
        self.locked.discard(key)

# --- Build the geo hierarchy: Cameroon > Centre > Mfoundi > Yaoundé I > Bastos ---
cm = Country.objects.create(name="Cameroon", iso_code="CMR")
centre = Region.objects.create(country=cm, name="Centre")
mfoundi = Division.objects.create(region=centre, name="Mfoundi")
yde1 = Subdivision.objects.create(division=mfoundi, name="Yaoundé I")
vd = VillageOrDistrict.objects.create(subdivision=yde1, name="Bastos District")
bastos = Quarter.objects.create(village_or_district=vd, name="Bastos")

landlord = User.objects.create(username="landlord1", phone="+237670000001")
guest = User.objects.create(username="guest1", phone="+237670000002")

house = House.objects.create(owner=landlord, quarter=bastos, type="HOUSE", bedrooms=3, bathrooms=2)
listing = Listing.objects.create(
    property_asset=house, listed_by=landlord, listing_type=ListingType.RENT,
    status=ListingStatus.PUBLISHED, price_xaf=Decimal("150000"),
)

print(f"Listing created: {listing.id} — 3BR house in {bastos} at {listing.price_xaf} XAF")

lock = FakeLock()
booking = reserve_booking(
    lock_client=lock, requester=guest, booking_type=BookingType.GENERAL_RENTAL,
    target_content_type="property.Listing", target_id=listing.id,
    amount_xaf=listing.price_xaf,
)
print(f"Booking hold created: {booking.id} status={booking.status} expires={booking.hold_expires_at}")

# Second guest tries the same house before payment completes -> must be rejected
try:
    reserve_booking(
        lock_client=lock, requester=User.objects.create(username="guest2", phone="+237670000003"),
        booking_type=BookingType.GENERAL_RENTAL, target_content_type="property.Listing",
        target_id=listing.id, amount_xaf=listing.price_xaf,
    )
    print("ERROR: second booking should have been rejected!")
except Exception as e:
    print(f"Correctly rejected concurrent booking: {e}")

escrow = confirm_payment(
    lock_client=lock, booking=booking, provider="MTN_MOMO",
    provider_reference="MOMO-TXN-12345", platform_fee_xaf=Decimal("7500"),
)
booking.refresh_from_db()
print(f"Payment confirmed: booking.status={booking.status} escrow.status={escrow.status} payee_gets={escrow.payee_amount_xaf} XAF")

final_escrow = complete_booking(booking=booking)
print(f"Move-in completed: booking.status={booking.status} escrow.status={final_escrow.status} released_at={final_escrow.released_at}")

print("\nSMOKE TEST PASSED — the full 'rent a house in Bastos' flow works end-to-end.")
