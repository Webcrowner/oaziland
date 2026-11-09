from oaziland.admin_base import register

from .models import Booking, Commission, Contract, PaymentEscrow

# Money records are view-only: they change only through payments, escrow release/refund and disputes.
register(Booking, read_only=True, list_display=("id", "booking_type", "requester", "status", "amount_xaf", "created_at"),
         list_filter=("status", "booking_type"), search_fields=("id", "requester__username", "requester__phone"),
         hidden_fields=("idempotency_key",))
register(PaymentEscrow, read_only=True, list_display=("booking_id", "gross_amount_xaf", "platform_fee_xaf", "payee_amount_xaf", "status", "provider", "held_at", "released_at"),
         list_filter=("status", "provider"), search_fields=("provider_reference", "booking__id"), ordering=("-held_at",))
register(Commission, read_only=True, list_display=("booking_id", "total_amount_xaf", "agency_share_xaf", "agent_share_xaf", "paid_to_landlord", "created_at"))
register(Contract, read_only=True, list_display=("booking_id", "contract_type", "signed_at", "created_at"), list_filter=("contract_type",))
