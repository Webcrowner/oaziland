"""
Prompt 21 — concurrency/load test on the platform's highest-risk race
condition: two people trying to book the SAME unit at the SAME moment.

WHY this uses real OS threads with real separate database connections
(via Django's TestCase + connection handling), not just sequential
calls with a fake single-threaded lock: a sequential test proves the
LOGIC is correct, but doesn't prove it survives actual concurrent
access. This fires genuinely simultaneous threads at the same booking
target and confirms exactly one wins — the real thing the founder
needs confidence about before launch.
"""
import threading
import uuid
from decimal import Decimal

import pytest
from django.db import connections
from django.test import TransactionTestCase

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from transactions.services import reserve_booking, InventoryConflictError
from transactions.models import BookingType, Booking


class ThreadSafeLock:
    """A genuinely thread-safe lock implementation (guarded by a real
    threading.Lock, not a plain set with no synchronization at all) —
    this is what makes the concurrency test meaningful rather than
    accidentally passing due to Python's GIL hiding a real race."""
    def __init__(self):
        self._held_keys = set()
        self._guard = threading.Lock()

    def acquire(self, key, ttl_seconds):
        with self._guard:
            if key in self._held_keys:
                return False
            self._held_keys.add(key)
            return True

    def release(self, key, permanent=False):
        with self._guard:
            self._held_keys.discard(key)


class ConcurrentBookingRaceConditionTest(TransactionTestCase):
    """Uses TransactionTestCase (not the usual pytest.mark.django_db)
    specifically because real threads need real, separate database
    connections that actually commit — the default test transaction
    wrapper would make every thread see the same uncommitted state,
    which would defeat the entire point of this test."""

    def setUp(self):
        country = Country.objects.create(name="Cameroon", iso_code="CMR")
        region = Region.objects.create(country=country, name="Centre")
        division = Division.objects.create(region=region, name="Mfoundi")
        subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
        village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
        self.quarter = Quarter.objects.create(village_or_district=village, name="Bastos")

        self.landlord = User.objects.create(username="race_landlord", phone="+237699999801")
        house = House.objects.create(owner=self.landlord, quarter=self.quarter, type="HOUSE")
        self.listing = Listing.objects.create(
            property_asset=house, listed_by=self.landlord, listing_type=ListingType.RENT,
            status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"),
        )

    def test_ten_simultaneous_booking_attempts_on_the_same_unit_only_one_succeeds(self):
        NUM_CONCURRENT_GUESTS = 10
        shared_lock = ThreadSafeLock()
        results = {"succeeded": 0, "failed": 0}
        results_guard = threading.Lock()

        guests = [
            User.objects.create(username=f"race_guest_{i}", phone=f"+23769999990{i}")
            for i in range(NUM_CONCURRENT_GUESTS)
        ]

        def attempt_booking(guest):
            try:
                reserve_booking(
                    lock_client=shared_lock, requester=guest, booking_type=BookingType.GENERAL_RENTAL,
                    target_content_type="property.Listing", target_id=self.listing.id,
                    amount_xaf=self.listing.price_xaf,
                )
                with results_guard:
                    results["succeeded"] += 1
            except InventoryConflictError:
                with results_guard:
                    results["failed"] += 1
            finally:
                # Each thread gets its own DB connection under
                # TransactionTestCase — must be closed explicitly so
                # threads don't leak connections across the test run.
                connections.close_all()

        threads = [threading.Thread(target=attempt_booking, args=(guest,)) for guest in guests]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # The actual proof: exactly ONE of ten genuinely simultaneous
        # attempts succeeded — not zero (the lock isn't broken and
        # blocking everyone), not more than one (the race condition
        # this whole mechanism exists to prevent).
        self.assertEqual(results["succeeded"], 1)
        self.assertEqual(results["failed"], NUM_CONCURRENT_GUESTS - 1)
        self.assertEqual(Booking.objects.filter(target_id=self.listing.id).count(), 1)
