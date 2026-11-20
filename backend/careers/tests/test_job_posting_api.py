"""
Tests for the real Job Posting API — closing a genuine gap:
JobPosting/JobApplication had real models and real service functions
(apply_to_job, update_application_status) but nothing ever exposed
either one over HTTP.
"""
import pytest
from decimal import Decimal
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User, KYCProfile, VerificationStatus
from careers.models import JobPosting, JobRoleCategory


def _verify(user):
    KYCProfile.objects.get_or_create(
        user=user,
        defaults={
            "legal_full_name": user.username,
            "date_of_birth": "1990-01-01",
            "national_id_number": f"CM-{user.id}",
            "residential_address": "Yaoundé",
            "kyc_status": VerificationStatus.VERIFIED,
        },
    )
    return user


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_creating_a_job_posting_sets_the_real_poster_and_requires_kyc():
    unverified = User.objects.create(username="job_unverified", phone="+237699555500")
    assert _auth_client(unverified).post("/api/jobs/", {
        "title": "Scam Job", "role_category": JobRoleCategory.OTHER, "description": "Easy money.",
    }).status_code == 403

    employer = _verify(User.objects.create(username="job_employer", phone="+237699555501"))
    client = _auth_client(employer)

    response = client.post("/api/jobs/", {
        "company_name": "Bastos Estates",
        "title": "Property Manager — Bastos Portfolio", "role_category": JobRoleCategory.PROPERTY_MANAGER,
        "employment_type": "FULL_TIME", "workplace_type": "HYBRID",
        "description": "Manage a 20-unit portfolio.", "salary_min_xaf": "250000", "salary_max_xaf": "400000",
    })

    assert response.status_code == 201
    assert str(response.data["posted_by"]) == str(employer.id)
    assert response.data["company_name"] == "Bastos Estates"
    assert response.data["employment_type"] == "FULL_TIME"
    assert response.data["workplace_type"] == "HYBRID"


@pytest.mark.django_db
def test_job_postings_are_publicly_browsable():
    employer = User.objects.create(username="job_public_employer", phone="+237699555502")
    JobPosting.objects.create(posted_by=employer, title="Driver Needed", role_category=JobRoleCategory.DRIVER, description="Full-time driver.")

    response = APIClient().get("/api/jobs/")

    assert response.status_code == 200
    assert response.data["count"] == 1


@pytest.mark.django_db
def test_applying_to_a_job_and_rejecting_a_duplicate():
    employer = User.objects.create(username="job_apply_employer", phone="+237699555503")
    applicant = User.objects.create(username="job_applicant", phone="+237699555504")
    posting = JobPosting.objects.create(posted_by=employer, title="Hostel Warden", role_category=JobRoleCategory.HOSTEL_WARDEN, description="Manage a hostel.")
    client = _auth_client(applicant)

    first_response = client.post(f"/api/jobs/{posting.id}/apply/", {"cover_message": "I have relevant experience."})
    assert first_response.status_code == 201

    second_response = client.post(f"/api/jobs/{posting.id}/apply/", {"cover_message": "Applying again"})
    assert second_response.status_code == 409


@pytest.mark.django_db
def test_only_the_poster_can_see_who_applied():
    employer = User.objects.create(username="job_privacy_employer", phone="+237699555505")
    applicant = User.objects.create(username="job_privacy_applicant", phone="+237699555506")
    stranger = User.objects.create(username="job_privacy_stranger", phone="+237699555507")
    posting = JobPosting.objects.create(posted_by=employer, title="Maintenance Staff", role_category=JobRoleCategory.MAINTENANCE_STAFF, description="General maintenance.")
    _auth_client(applicant).post(f"/api/jobs/{posting.id}/apply/", {})

    employer_view = _auth_client(employer).get(f"/api/jobs/{posting.id}/applications/")
    stranger_view = _auth_client(stranger).get(f"/api/jobs/{posting.id}/applications/")

    assert employer_view.status_code == 200
    assert len(employer_view.data) == 1
    assert stranger_view.status_code == 403


@pytest.mark.django_db
def test_only_the_poster_can_edit_their_job_posting():
    employer = User.objects.create(username="job_edit_employer", phone="+237699555508")
    stranger = User.objects.create(username="job_edit_stranger", phone="+237699555509")
    posting = JobPosting.objects.create(posted_by=employer, title="Agent Role", role_category=JobRoleCategory.AGENT, description="Real estate agent.")

    response = _auth_client(stranger).patch(f"/api/jobs/{posting.id}/", {"title": "Hijacked Title"})

    assert response.status_code == 403
    posting.refresh_from_db()
    assert posting.title == "Agent Role"


@pytest.mark.django_db
def test_my_job_applications_are_scoped_to_the_requester():
    employer = User.objects.create(username="job_myapps_employer", phone="+237699555510")
    applicant_a = User.objects.create(username="job_myapps_a", phone="+237699555511")
    applicant_b = User.objects.create(username="job_myapps_b", phone="+237699555512")
    posting = JobPosting.objects.create(posted_by=employer, title="Driver Role", role_category=JobRoleCategory.DRIVER, description="Driving.")
    _auth_client(applicant_a).post(f"/api/jobs/{posting.id}/apply/", {})

    a_apps = _auth_client(applicant_a).get("/api/my-job-applications/")
    b_apps = _auth_client(applicant_b).get("/api/my-job-applications/")

    assert a_apps.data["count"] == 1
    assert b_apps.data["count"] == 0


@pytest.mark.django_db
def test_creating_a_job_posting_requires_authentication():
    response = APIClient().post("/api/jobs/", {"title": "Test", "role_category": JobRoleCategory.OTHER, "description": "Test"})
    assert response.status_code == 401


def _job(employer, **extra):
    return JobPosting.objects.create(posted_by=employer, title=extra.pop("title", "Driver"), role_category=extra.pop("role_category", JobRoleCategory.DRIVER), description="Work.", **extra)


@pytest.mark.django_db
def test_closed_and_expired_jobs_are_not_listed_and_cannot_be_applied_to():
    from datetime import timedelta
    from django.utils import timezone
    employer = User.objects.create(username="job_exp_employer", phone="+237699555520")
    applicant = User.objects.create(username="job_exp_applicant", phone="+237699555521")
    open_job = _job(employer, title="Open")
    closed = _job(employer, title="Closed", status="CLOSED")
    expired = _job(employer, title="Expired", closes_at=timezone.now() - timedelta(days=1))

    titles = [row["title"] for row in APIClient().get("/api/jobs/").data["results"]]
    assert titles == ["Open"]

    client = _auth_client(applicant)
    assert client.post(f"/api/jobs/{closed.id}/apply/", {}).status_code == 409
    assert client.post(f"/api/jobs/{expired.id}/apply/", {}).status_code == 409
    assert client.post(f"/api/jobs/{open_job.id}/apply/", {}).status_code == 201


@pytest.mark.django_db
def test_a_poster_cannot_apply_to_their_own_job_and_can_close_it():
    employer = User.objects.create(username="job_own_employer", phone="+237699555522")
    stranger = User.objects.create(username="job_own_stranger", phone="+237699555523")
    job = _job(employer)

    assert _auth_client(employer).post(f"/api/jobs/{job.id}/apply/", {}).status_code == 403
    assert _auth_client(stranger).post(f"/api/jobs/{job.id}/close/").status_code == 403
    closed = _auth_client(employer).post(f"/api/jobs/{job.id}/close/")
    assert closed.status_code == 200 and closed.data["status"] == "CLOSED" and closed.data["is_open"] is False
    assert APIClient().get("/api/jobs/").data["count"] == 0
    # The poster still finds it in their own list.
    mine = _auth_client(employer).get("/api/jobs/?mine=1")
    assert [row["id"] for row in mine.data["results"]] == [str(job.id)]


@pytest.mark.django_db
def test_jobs_can_be_filtered_by_role_and_searched_and_show_my_application():
    employer = User.objects.create(username="job_filter_employer", phone="+237699555524")
    applicant = User.objects.create(username="job_filter_applicant", phone="+237699555525")
    driver = _job(employer, title="City driver")
    _job(employer, title="Hostel warden", role_category=JobRoleCategory.HOSTEL_WARDEN)

    assert [r["title"] for r in APIClient().get("/api/jobs/?role_category=DRIVER").data["results"]] == ["City driver"]
    assert [r["title"] for r in APIClient().get("/api/jobs/?q=warden").data["results"]] == ["Hostel warden"]

    client = _auth_client(applicant)
    client.post(f"/api/jobs/{driver.id}/apply/", {})
    rows = {r["title"]: r for r in client.get("/api/jobs/").data["results"]}
    assert rows["City driver"]["my_application_status"] == "SUBMITTED" and rows["Hostel warden"]["my_application_status"] is None
    assert APIClient().get("/api/jobs/").data["results"][0]["my_application_status"] is None


@pytest.mark.django_db
def test_job_validation_and_cover_message_limit():
    from datetime import timedelta
    from django.utils import timezone
    employer = _verify(User.objects.create(username="job_val_employer", phone="+237699555526"))
    applicant = User.objects.create(username="job_val_applicant", phone="+237699555527")
    body = {"title": "Driver", "role_category": "DRIVER", "description": "Drive."}
    client = _auth_client(employer)

    assert client.post("/api/jobs/", {**body, "salary_min_xaf": "500000", "salary_max_xaf": "100000"}).status_code == 400
    past = (timezone.now() - timedelta(days=1)).isoformat()
    assert client.post("/api/jobs/", {**body, "closes_at": past}).status_code == 400
    job = _job(employer)
    assert _auth_client(applicant).post(f"/api/jobs/{job.id}/apply/", {"cover_message": "x" * 2001}).status_code == 400


@pytest.mark.django_db
def test_the_poster_and_the_applicant_are_notified():
    from notifications.models import Notification
    employer = User.objects.create(username="job_note_employer", phone="+237699555528")
    applicant = User.objects.create(username="job_note_applicant", phone="+237699555529")
    job = _job(employer, title="Warden")
    _auth_client(applicant).post(f"/api/jobs/{job.id}/apply/", {})
    assert Notification.objects.filter(recipient=employer, notification_type="JOB_APPLICATION", related_reference=str(job.id)).exists()

    application = job.applications.get()
    response = _auth_client(employer).post(f"/api/jobs/{job.id}/update-application/", {"application_id": str(application.id), "new_status": "HIRED"})
    assert response.status_code == 200
    assert Notification.objects.filter(recipient=applicant, notification_type="JOB_APPLICATION_UPDATE").count() == 1
    # Setting the same status again doesn't notify twice.
    _auth_client(employer).post(f"/api/jobs/{job.id}/update-application/", {"application_id": str(application.id), "new_status": "HIRED"})
    assert Notification.objects.filter(recipient=applicant, notification_type="JOB_APPLICATION_UPDATE").count() == 1


@pytest.mark.django_db
def test_applicant_can_upload_private_pdf_cv_and_only_poster_or_applicant_can_download_it(monkeypatch, tmp_path):
    from django.core.files.storage import FileSystemStorage
    from django.core.files.uploadedfile import SimpleUploadedFile
    from django.utils import timezone
    from careers.models import JobApplication, TrainingCategory, TrainingEnrollment, TrainingProgram

    monkeypatch.setattr(JobApplication._meta.get_field("cv_file"), "storage", FileSystemStorage(location=tmp_path / "private_media"))
    employer = _verify(User.objects.create(username="cv_employer", phone="+237699555540"))
    applicant = User.objects.create(username="cv_applicant", phone="+237699555541", first_name="Awa", last_name="Mbah")
    stranger = User.objects.create(username="cv_stranger", phone="+237699555542")
    job = _job(employer, title="Senior Agent", company_name="Akwa Realty")

    # Give the applicant a verified Oaziland certificate so the employer sees it alongside the CV.
    prog = TrainingProgram.objects.create(provider=employer, title="Agency Licensing Prep", category=TrainingCategory.AGENCY_LICENSING_PREP, issues_certification=True)
    TrainingEnrollment.objects.create(
        program=prog, student=applicant, status="COMPLETED",
        certificate_code="OAZ-CERT-01", certificate_issued_at=timezone.now(),
    )

    # Non-PDF files are rejected cleanly with 400.
    bad_cv = SimpleUploadedFile("resume.exe", b"MZ-not-a-pdf", content_type="application/octet-stream")
    bad_resp = _auth_client(applicant).post(
        f"/api/jobs/{job.id}/apply/",
        {"cover_message": "Hello", "cv_file": bad_cv},
        format="multipart",
    )
    assert bad_resp.status_code == 400

    valid_pdf = SimpleUploadedFile("Awa_Mbah_CV.pdf", b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", content_type="application/pdf")
    created = _auth_client(applicant).post(
        f"/api/jobs/{job.id}/apply/",
        {"cover_message": "Licensed bilingual agent.", "years_experience": 4, "cv_file": valid_pdf},
        format="multipart",
    )
    assert created.status_code == 201, created.data
    app_id = created.data["id"]
    assert created.data["has_cv"] is True
    assert created.data["cv_filename"] == "Awa_Mbah_CV.pdf"
    assert created.data["years_experience"] == 4
    assert created.data["certificates"] == [{"code": "OAZ-CERT-01", "title": "Agency Licensing Prep"}]

    # Stored in private_media, never inside public MEDIA_ROOT.
    assert any((tmp_path / "private_media" / "job_cvs").glob("*.pdf"))

    # Employer sees CV metadata, phone, experience, and certificates, and can download the PDF.
    listed = _auth_client(employer).get(f"/api/jobs/{job.id}/applications/")
    assert listed.status_code == 200 and listed.data[0]["has_cv"] is True
    dl_employer = _auth_client(employer).get(f"/api/jobs/{job.id}/applications/{app_id}/cv/")
    assert dl_employer.status_code == 200
    assert dl_employer["Content-Type"] == "application/pdf"
    assert dl_employer["X-Content-Type-Options"] == "nosniff"
    assert b"".join(dl_employer.streaming_content).startswith(b"%PDF-1.4")

    # Applicant can download their own CV via /api/my-job-applications/<id>/cv/, but an outsider gets 403.
    assert _auth_client(applicant).get(f"/api/my-job-applications/{app_id}/cv/").status_code == 200
    assert _auth_client(stranger).get(f"/api/jobs/{job.id}/applications/{app_id}/cv/").status_code == 403

    # Applicant can withdraw their application, cleaning up the private file.
    withdrawn = _auth_client(applicant).post(f"/api/my-job-applications/{app_id}/withdraw/")
    assert withdrawn.status_code == 204
    assert job.applications.count() == 0
    assert not list((tmp_path / "private_media" / "job_cvs").glob("*.pdf"))


@pytest.mark.django_db
def test_job_posting_moderation_blocks_flagged_text_on_create_and_edit(monkeypatch):
    from trust_safety.models import ModerationAction
    employer = _verify(User.objects.create(username="job_mod_employer", phone="+237699555543"))
    job = _job(employer, title="Clean Opening")

    # Clean edit works for the poster.
    edited = _auth_client(employer).patch(f"/api/jobs/{job.id}/", {"title": "Updated Opening", "employment_type": "CONTRACT"})
    assert edited.status_code == 200 and edited.data["title"] == "Updated Opening" and edited.data["employment_type"] == "CONTRACT"

    monkeypatch.setattr("trust_safety.services._worst_action", lambda _results: ModerationAction.AUTO_REMOVE)

    blocked = _auth_client(employer).post("/api/jobs/", {
        "title": "Blocked Job", "role_category": "OTHER", "description": "Abusive scam content.",
    })
    assert blocked.status_code == 400
    assert JobPosting.objects.filter(posted_by=employer).count() == 1

    blocked_patch = _auth_client(employer).patch(f"/api/jobs/{job.id}/", {"description": "Abusive scam content."})
    assert blocked_patch.status_code == 400
    job.refresh_from_db()
    assert job.description == "Work."


@pytest.mark.django_db
def test_job_notifications_resolve_to_clickable_job_targets():
    employer = _verify(User.objects.create(username="job_link_employer", phone="+237699555544"))
    applicant = User.objects.create(username="job_link_applicant", phone="+237699555545")
    job = _job(employer, title="Leasing Agent")

    applied = _auth_client(applicant).post(f"/api/jobs/{job.id}/apply/", {})
    assert applied.status_code == 201
    emp_inbox = _auth_client(employer).get("/api/my-notifications/").data["results"]
    assert emp_inbox[0]["target"] == {"kind": "job", "id": str(job.id)}

    _auth_client(employer).post(
        f"/api/jobs/{job.id}/update-application/",
        {"application_id": applied.data["id"], "new_status": "SHORTLISTED"},
    )
    app_inbox = _auth_client(applicant).get("/api/my-notifications/").data["results"]
    assert app_inbox[0]["target"] == {"kind": "job", "id": str(job.id)}


@pytest.mark.django_db
def test_deleting_a_job_or_account_cleans_up_private_cv_files_and_exports_include_jobs(monkeypatch, tmp_path):
    import json
    from django.core.files.storage import FileSystemStorage
    from django.core.files.uploadedfile import SimpleUploadedFile
    from careers.models import JobApplication
    from compliance.services import complete_account_deletion, generate_data_export

    monkeypatch.setattr(JobApplication._meta.get_field("cv_file"), "storage", FileSystemStorage(location=tmp_path / "private_media"))
    employer = _verify(User.objects.create(username="cascade_employer", phone="+237699555560"))
    applicant = User.objects.create(username="cascade_applicant", phone="+237699555561")
    job_a = _job(employer, title="Job A")
    job_b = _job(employer, title="Job B")

    pdf_a = SimpleUploadedFile("cv_a.pdf", b"%PDF-1.4 a", content_type="application/pdf")
    pdf_b = SimpleUploadedFile("cv_b.pdf", b"%PDF-1.4 b", content_type="application/pdf")
    assert _auth_client(applicant).post(f"/api/jobs/{job_a.id}/apply/", {"cv_file": pdf_a}, format="multipart").status_code == 201
    assert _auth_client(applicant).post(f"/api/jobs/{job_b.id}/apply/", {"cv_file": pdf_b}, format="multipart").status_code == 201
    assert len(list((tmp_path / "private_media" / "job_cvs").glob("*.pdf"))) == 2

    # GDPR export includes job applications.
    export_req = generate_data_export(applicant)
    export_req.export_file.open()
    exported = json.loads(export_req.export_file.read())
    export_req.export_file.close()
    export_req.export_file.delete(save=False)
    assert len(exported["job_applications"]) == 2 and exported["job_applications"][0]["has_cv"] is True

    # Deleting job_a via API removes cv_a from disk via post_delete signal.
    assert _auth_client(employer).delete(f"/api/jobs/{job_a.id}/").status_code == 204
    assert len(list((tmp_path / "private_media" / "job_cvs").glob("*.pdf"))) == 1

    # Deleting the applicant's account removes remaining CVs; deleting employer closes open postings.
    complete_account_deletion(applicant)
    assert len(list((tmp_path / "private_media" / "job_cvs").glob("*.pdf"))) == 0
    complete_account_deletion(employer)
    job_b.refresh_from_db()
    assert job_b.status == "CLOSED"


@pytest.mark.django_db
def test_reopen_whatsapp_share_url_and_block_enforcement():
    from datetime import timedelta
    from django.utils import timezone
    from engagement.services import block_user

    employer = _verify(User.objects.create(username="reopen_employer", phone="+237699555562"))
    applicant = User.objects.create(username="reopen_applicant", phone="+237699555563")
    job = _job(employer, title="Night Warden", status="CLOSED", closes_at=timezone.now() - timedelta(days=2))

    # WhatsApp share uses the real /careers?job=<uuid> route, not /careers.jobposting/<uuid>.
    shared = _auth_client(employer).post(f"/api/jobs/{job.id}/share/", {"recipient_phone": "+237670000888"})
    assert shared.status_code == 200
    assert f"https://oaziland.com/careers?job={job.id}" in shared.data["message"]

    # Stranger cannot reopen; poster can reopen and expired closes_at is cleared.
    assert _auth_client(applicant).post(f"/api/jobs/{job.id}/reopen/").status_code == 403
    reopened = _auth_client(employer).post(f"/api/jobs/{job.id}/reopen/")
    assert reopened.status_code == 200 and reopened.data["is_open"] is True and reopened.data["closes_at"] is None

    # Blocking hides the job from the blocked user's browse feed and refuses apply.
    block_user(blocker=employer, blocked=applicant)
    assert _auth_client(applicant).get("/api/jobs/").data["count"] == 0
    assert _auth_client(applicant).post(f"/api/jobs/{job.id}/apply/", {}).status_code == 403
