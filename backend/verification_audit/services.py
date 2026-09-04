"""
verification_audit.services — BlockchainVerificationService: compute a
document hash, anchor it into the tamper-evident chain, and verify a
document against a previously anchored hash later.

Composes onto property.VerificationBadge, land.SecureDocument, and
transactions.Contract — none of those models change; this just adds an
anchor record alongside whichever of them triggered it.
"""
import hashlib


def compute_document_hash(content: bytes) -> str:
    """SHA-256 of the raw document bytes. The actual algorithm choice
    matters less than that it's applied CONSISTENTLY — anchoring and
    later verification must use the exact same function."""
    return hashlib.sha256(content).hexdigest()


def anchor_document(*, subject, subject_type: str, document_content: bytes, anchored_by):
    """The core of the hash chain: this record's chain_record_hash is
    computed over its own document_hash PLUS the previous record's
    chain_record_hash — so altering ANY past record breaks every
    subsequent one's verifiability, the same tamper-evidence property a
    real blockchain provides."""
    from .models import BlockchainAnchorRecord

    document_hash = compute_document_hash(document_content)
    last_record = BlockchainAnchorRecord.objects.order_by("-anchored_at").first()
    previous_hash = last_record.chain_record_hash if last_record else ""

    chain_record_hash = hashlib.sha256(f"{document_hash}{previous_hash}".encode()).hexdigest()

    content_type = f"{subject._meta.app_label}.{subject.__class__.__name__}"
    return BlockchainAnchorRecord.objects.create(
        subject_type=subject_type, subject_content_type=content_type, subject_id=subject.id,
        document_hash=document_hash, previous_record_hash=previous_hash,
        chain_record_hash=chain_record_hash, anchored_by=anchored_by,
    )


def verify_document_against_anchor(*, anchor_record, document_content: bytes) -> bool:
    """Recomputes the hash of a document NOW and checks it matches what
    was anchored THEN — proving (or disproving) the document hasn't
    been altered since anchoring."""
    return compute_document_hash(document_content) == anchor_record.document_hash


def verify_chain_integrity() -> bool:
    """Walks the ENTIRE chain and confirms every record's chain_record_
    hash is still correctly derived from its document_hash and the
    actual previous record — proving no record has been tampered with
    or reordered since it was written. This is the real tamper-evidence
    check, not just trusting each record in isolation."""
    from .models import BlockchainAnchorRecord
    import hashlib as _hashlib

    records = list(BlockchainAnchorRecord.objects.order_by("anchored_at"))
    previous_hash = ""
    for record in records:
        expected = _hashlib.sha256(f"{record.document_hash}{previous_hash}".encode()).hexdigest()
        if expected != record.chain_record_hash or record.previous_record_hash != previous_hash:
            return False
        previous_hash = record.chain_record_hash
    return True


def anchor_verification_badge_approval(*, badge, document_content: bytes):
    """Convenience wrapper: called at the moment a VerificationBadge
    (property app) is approved, anchoring the underlying document at
    exactly that point — composes onto VerificationBadge without
    modifying it at all."""
    from .models import AnchorSubjectType
    return anchor_document(
        subject=badge, subject_type=AnchorSubjectType.VERIFICATION_BADGE,
        document_content=document_content, anchored_by=badge.verified_by,
    )


def anchor_signed_contract(*, contract, document_content: bytes, anchored_by):
    """Convenience wrapper for transactions.Contract, called after
    Contract.sign() — proves exactly what was signed, unaltered."""
    from .models import AnchorSubjectType
    return anchor_document(
        subject=contract, subject_type=AnchorSubjectType.CONTRACT,
        document_content=document_content, anchored_by=anchored_by,
    )
