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

GUIDELINES_REVIEW_NOTICE = (
    "*** DRAFT — reflects the specific content decisions made so far. "
    "Review before publishing publicly, and expand as further content "
    "policy decisions are made. ***\n\n"
)

COMMUNITY_GUIDELINES_DRAFT = GUIDELINES_REVIEW_NOTICE + (
    "Oaziland's social feed exists to help agents, agencies, landlords, "
    "and everyday users share real property updates, business "
    "services, and professional content — it is not a general "
    "entertainment platform.\n\n"
    "Real estate and business content comes first. The recommendation "
    "feed is built to prioritize property listings and service "
    "updates over generic content.\n\n"
    "Dancing and dance-entertainment content is not encouraged. Posts "
    "of this kind are allowed to remain on the platform, but they will "
    "never be promoted or recommended by the feed algorithm — this "
    "keeps the social feed focused on its real purpose.\n\n"
    "Standard trust & safety rules apply to everything posted here, "
    "the same as anywhere else on the platform: content is screened "
    "before publishing, reports are reviewed by a real admin, and "
    "repeated violations lead to warnings, temporary suspension, and "
    "eventually a permanent ban, per the platform's existing strike policy."
)


class Command(BaseCommand):
    help = "Seeds draft (legally unreviewed) v0.1 Privacy Policy, Terms of Service, and Community Guidelines documents."

    def handle(self, *args, **options):
        for doc_type, text in [
            (PolicyDocumentType.PRIVACY_POLICY, PRIVACY_POLICY_DRAFT),
            (PolicyDocumentType.TERMS_OF_SERVICE, TERMS_OF_SERVICE_DRAFT),
            (PolicyDocumentType.COMMUNITY_GUIDELINES, COMMUNITY_GUIDELINES_DRAFT),
        ]:
            _, created = PolicyDocument.objects.get_or_create(
                document_type=doc_type, version="0.1-draft",
                defaults={"body_text": text, "is_current": True},
            )
            if created:
                self.stdout.write(self.style.WARNING(f"Seeded DRAFT {doc_type} v0.1 — requires review before use."))
