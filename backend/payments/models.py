"""
payments — Mobile Money (MTN MoMo, Orange Money) integration clients live
here as service classes, not models; PaymentEscrow itself (the ledger
record) lives in `transactions` since it's owned by the Booking lifecycle.
This app holds provider adapters and webhook handlers. Not yet implemented.
"""
