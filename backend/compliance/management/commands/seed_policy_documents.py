"""
Seeds placeholder v0.1-draft Privacy Policy and Terms of Service
documents — clearly marked as DRAFTS requiring the founder's lawyer's
review, per Prompt 20's explicit instruction that this prompt builds
the technical mechanism, not the legal text itself. Claude is not
qualified to author binding legal text, and doing so anyway would be
irresponsible given the KYC/biometric data this platform collects.
"""
from django.core.management.base import BaseCommand
from compliance.models import PolicyDocument, PolicyDocumentType

DRAFT_NOTICE = (
    "*** DRAFT PLACEHOLDER — NOT LEGALLY REVIEWED. DO NOT PUBLISH OR RELY "
    "ON THIS TEXT. Replace with real Privacy Policy/Terms of Service "
    "content reviewed by a qualified lawyer before this platform "
    "launches, especially given the KYC, biometric, and financial data "
    "this platform collects. ***\n\n"
)

PRIVACY_POLICY_DRAFT = DRAFT_NOTICE + (
    "This placeholder should be replaced with a real Privacy Policy "
    "covering: what personal data Oaziland collects (identity/KYC "
    "documents, location, payment and transaction data, messages, "
    "usage data); why it's collected and how it's used; who it's "
    "shared with (payment processors, KYC verification providers, "
    "Taskln, government authorities where legally required); how long "
    "it's retained; users' rights (access, export, deletion, consent "
    "withdrawal) and how to exercise them; and contact information for "
    "privacy inquiries."
)

TERMS_OF_SERVICE_DRAFT = DRAFT_NOTICE + (
    "This placeholder should be replaced with real Terms of Service "
    "covering: eligibility and account requirements; platform fees and "
    "payment terms; listing accuracy and prohibited content; dispute "
    "resolution procedures; liability limitations; account suspension "
    "and termination policy; and governing law (Cameroon, given the "
    "platform's primary market)."
)


class Command(BaseCommand):
    help = "Seeds draft (legally unreviewed) v0.1 Privacy Policy and Terms of Service documents."

    def handle(self, *args, **options):
        for doc_type, text in [
            (PolicyDocumentType.PRIVACY_POLICY, PRIVACY_POLICY_DRAFT),
            (PolicyDocumentType.TERMS_OF_SERVICE, TERMS_OF_SERVICE_DRAFT),
        ]:
            _, created = PolicyDocument.objects.get_or_create(
                document_type=doc_type, version="0.1-draft",
                defaults={"body_text": text, "is_current": True},
            )
            if created:
                self.stdout.write(self.style.WARNING(f"Seeded DRAFT {doc_type} v0.1 — requires legal review before use."))
