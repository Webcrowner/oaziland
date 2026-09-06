"""
Tests proving the module's final literal acceptance criteria: a
Property Manager job posting receiving an application, and a Tenant Law
Basics training enrollment tracked to completion.
"""
import pytest
from decimal import Decimal

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from careers.models import JobRoleCategory, JobApplicationStatus, TrainingCategory, TrainingEnrollmentStatus
from careers.services import (
    apply_to_job, update_application_status, share_job_posting_via_whatsapp,
    enroll_in_training, mark_training_completed, AlreadyAppliedError,
)
from engagement.models import ActionLog


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_property_manager_job_posting_receives_an_application(quarter):
    """The module's literal acceptance criteria, job half."""
    from careers.models import JobPosting
    employer = User.objects.create(username="careers_employer", phone="+237699800001")
    applicant = User.objects.create(username="careers_applicant", phone="+237699800002")

    posting = JobPosting.objects.create(
        posted_by=employer, title="Property Manager — Bastos Portfolio",
        role_category=JobRoleCategory.PROPERTY_MANAGER, description="Manage a 20-unit portfolio in Bastos.",
        quarter=quarter, salary_min_xaf=Decimal("250000"), salary_max_xaf=Decimal("400000"),
    )

    application = apply_to_job(job_posting=posting, applicant=applicant, cover_message="I have 3 years of experience.")
    assert application.status == JobApplicationStatus.SUBMITTED
    assert posting.applications.count() == 1

    # A duplicate application from the same person must be rejected —
    # with a clean, specific error now (AlreadyAppliedError), not a
    # raw database IntegrityError, matching the same fix already
    # applied to training enrollment's AlreadyEnrolledError.
    with pytest.raises(AlreadyAppliedError):
        apply_to_job(job_posting=posting, applicant=applicant, cover_message="Applying again")

    update_application_status(application=application, new_status=JobApplicationStatus.SHORTLISTED)
    application.refresh_from_db()
    assert application.status == JobApplicationStatus.SHORTLISTED


@pytest.mark.django_db
def test_job_posting_shared_via_whatsapp_reuses_part_b(quarter):
    from careers.models import JobPosting
    employer = User.objects.create(username="careers_employer_2", phone="+237699800003")
    posting = JobPosting.objects.create(
        posted_by=employer, title="Hostel Warden Needed", role_category=JobRoleCategory.HOSTEL_WARDEN,
        description="Evening shift warden for a 40-bed hostel.", quarter=quarter,
    )

    result = share_job_posting_via_whatsapp(job_posting=posting, shared_by=employer, recipient_phone="+237670000999")
    assert "Oaziland" in result["message"]
    assert ActionLog.objects.filter(target_id=posting.id).exists()


@pytest.mark.django_db
def test_tenant_law_training_enrollment_tracked_to_completion():
    """The module's literal acceptance criteria, training half."""
    from careers.models import TrainingProgram
    provider = User.objects.create(username="careers_training_provider", phone="+237699800004")
    student = User.objects.create(username="careers_training_student", phone="+237699800005")

    program = TrainingProgram.objects.create(
        provider=provider, title="Tenant Law Basics", category=TrainingCategory.TENANT_LAW,
        price_xaf=Decimal("15000"), issues_certification=True,
    )

    enrollment = enroll_in_training(program=program, student=student)
    assert enrollment.status == TrainingEnrollmentStatus.ENROLLED
    assert enrollment.certificate_issued_at is None

    mark_training_completed(enrollment)
    enrollment.refresh_from_db()
    assert enrollment.status == TrainingEnrollmentStatus.COMPLETED
    assert enrollment.completed_at is not None
    assert enrollment.certificate_issued_at is not None  # program issues certification


@pytest.mark.django_db
def test_training_without_certification_completes_without_issuing_one():
    from careers.models import TrainingProgram
    provider = User.objects.create(username="careers_training_provider_2", phone="+237699800006")
    student = User.objects.create(username="careers_training_student_2", phone="+237699800007")

    program = TrainingProgram.objects.create(
        provider=provider, title="Casual Property Meetup", category=TrainingCategory.OTHER,
        issues_certification=False,
    )
    enrollment = enroll_in_training(program=program, student=student)
    mark_training_completed(enrollment)
    enrollment.refresh_from_db()

    assert enrollment.status == TrainingEnrollmentStatus.COMPLETED
    assert enrollment.certificate_issued_at is None  # correctly withheld — program doesn't offer one
