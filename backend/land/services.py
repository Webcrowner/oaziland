"""
land.services — the Land Due-Diligence Report: aggregates data that
already exists across three separate models (Land's own title fields,
property.VerificationBadge, and land.ScamFlag) into one buyer-facing
report, rather than a buyer having to check three places themselves.
"""


def generate_due_diligence_report(*, land, requested_by=None):
    from property.models import VerificationBadge, BadgeStatus
    from .models import LandDueDiligenceReport, ScamFlag

    title_status_summary = {
        "title_deed_number": land.title_deed_number,
        "title_type": land.title_type,
        "land_use_type": land.land_use_type,
        "bornes_visibles": land.bornes_visibles,
        "can_publish": land.can_publish(),
    }

    badges = VerificationBadge.objects.filter(property_asset=land)
    verification_summary = {
        badge.badge_type: badge.status for badge in badges
    }

    scam_flags = ScamFlag.objects.filter(land=land)
    scam_flag_summary = {
        "total_flags": scam_flags.count(),
        "open_flags": scam_flags.filter(status="OPEN").count(),
    }

    # A simple, explainable risk rule — not a black-box score.
    if scam_flag_summary["open_flags"] > 0 or not title_status_summary["can_publish"]:
        risk_level = "HIGH"
    elif not all(status == BadgeStatus.VERIFIED for status in verification_summary.values()) or not verification_summary:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    return LandDueDiligenceReport.objects.create(
        land=land, requested_by=requested_by,
        title_status_summary=title_status_summary,
        verification_summary=verification_summary,
        scam_flag_summary=scam_flag_summary,
        overall_risk_level=risk_level,
    )
