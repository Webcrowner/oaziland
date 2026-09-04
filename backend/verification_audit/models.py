"""
verification_audit — BlockchainVerificationService: a tamper-evident
audit trail for document/title hashes, composing onto the EXISTING
VerificationBadge, SecureDocument, and Contract models rather than
replacing PaymentEscrow or any other tested payment infrastructure.

WHY this exists as a separate app: it's an AUDIT/TRUST layer, not a
transactional one — it never moves money, never gates a booking. It
answers one question only: 'can I prove this document existed,
unaltered, at this point in time.'
"""
import hashlib
import uuid
from django.conf import settings
from django.db import models


class AnchorSubjectType(models.TextChoices):
    TITLE_DEED = "TITLE_DEED", "Title Deed"
    CONTRACT = "CONTRACT", "Contract"
    KYC_DOCUMENT = "KYC_DOCUMENT", "KYC Document"
    VERIFICATION_BADGE = "VERIFICATION_BADGE", "Verification Badge"


class ChainProvider(models.TextChoices):
    """WHY a choice field instead of committing to one chain now: the
    real distributed-ledger decision (public chain vs. permissioned
    Hyperledger-style network) is explicitly a LATER decision per the
    Architecture document — this lets the anchor records exist and be
    verified today, with the actual provider swapped in later without
    touching anything that already anchored a hash."""
    LOCAL_HASH_CHAIN = "LOCAL_HASH_CHAIN", "Local Hash Chain (interim)"
    ETHEREUM = "ETHEREUM", "Ethereum"
    HYPERLEDGER = "HYPERLEDGER", "Hyperledger"


class BlockchainAnchorRecord(models.Model):
    """One anchored document hash. WHY previous_record_hash exists: each
    new record's stored hash is computed over ITS OWN data PLUS the
    previous record's hash — a genuine hash chain. If any past record
    were ever altered, every subsequent record's hash would no longer
    verify, exactly the tamper-evidence property a real blockchain
    provides, implemented here as a real, working, centrally-stored
    chain rather than a decentralized one. This is an honest interim
    step, not a claim of being an actual blockchain."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject_type = models.CharField(max_length=20, choices=AnchorSubjectType.choices)
    subject_content_type = models.CharField(max_length=50)
    subject_id = models.UUIDField()
    document_hash = models.CharField(max_length=64)  # SHA-256 of the document content
    previous_record_hash = models.CharField(max_length=64, blank=True)  # empty only for the very first record
    chain_record_hash = models.CharField(max_length=64)  # hash of (document_hash + previous_record_hash)
    chain_provider = models.CharField(max_length=20, choices=ChainProvider.choices, default=ChainProvider.LOCAL_HASH_CHAIN)
    external_transaction_reference = models.CharField(max_length=255, blank=True)  # populated once a real chain is connected
    anchored_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    anchored_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "blockchain_anchor_records"
        indexes = [models.Index(fields=["subject_content_type", "subject_id"])]
        ordering = ["anchored_at"]
