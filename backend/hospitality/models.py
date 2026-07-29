"""
hospitality — scaffold for Hotels, Event Centers, Student Hostels, and
Guest Houses (Architecture doc §7-8). Deferred to Phase 2 per the agreed
MVP scope, EXCEPT Student Hostels, which GRE-MOD-SPEC-002 recommends
launching first via the ICT University relationship.

Planned models (not yet implemented):
  hotels/          Hotel(PropertyAsset), RoomType, PhysicalRoom, Reservation,
                    GuestFolio, FolioCharge, POSOrder, HousekeepingTask, GroupBooking
  events/           EventCenter(PropertyAsset), VenueSpace, EventBooking,
                    BookingPayment, GuestListEntry, Caterer, Vendor, VendorBooking
  student_hostels/  StudentHostel(Building), HostelRoom, RoomAllocation, Semester,
                    HostelBilling, WelfareAlert, ParentGuardianAccess, InstitutionIntegration
  guest_houses/     ChannelListing, BookingHold, GuestVerification, EscrowPayout
"""
