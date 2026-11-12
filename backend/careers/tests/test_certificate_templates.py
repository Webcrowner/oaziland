"""The admin certificate designer: templates, uploads, preview, and the active template being used for issued certificates."""
import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from careers.certificate_templates import TemplateError, clean_layout
from careers.models import CertificateTemplate, CourseStaff, CourseStaffRole, TrainingCategory, TrainingEnrollment, TrainingProgram
from identity.models import AdminProfile, User

API = "/api/admin/certificate-templates/"


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _user(name):
    return User.objects.create(username=name, phone=f"+2376{abs(hash(name)) % 10**8:08d}", first_name=name.title())


@pytest.fixture
def admin(db, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    user = _user("ct_admin")
    AdminProfile.objects.create(user=user)
    return _client(user)


def _png(size, color="white", fmt="PNG"):
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format=fmt)
    return buffer.getvalue()


@pytest.mark.django_db
def test_only_admins_can_manage_certificate_templates(admin):
    assert APIClient().get(API).status_code == 401
    assert _client(_user("ct_learner")).get(API).status_code == 403
    listing = admin.get(API).json()
    assert listing["builtin_active"] is True and listing["results"] == []
    assert "learner_name" in listing["placeholders"]


@pytest.mark.django_db
def test_a_blank_pdf_certificate_becomes_the_background_and_sets_the_orientation(admin):
    template = admin.post(API, {"name": "Gold", "start_from": "empty"}, format="json").json()
    assert template["layout"] == [] and template["orientation"] == "LANDSCAPE"

    pdf = SimpleUploadedFile("blank.pdf", _png((595, 842), fmt="PDF"), content_type="application/pdf")
    updated = admin.post(f"{API}{template['id']}/background/", {"file": pdf}, format="multipart").json()
    assert updated["orientation"] == "PORTRAIT" and updated["background_image_url"].endswith(".png")

    not_a_certificate = SimpleUploadedFile("notes.docx", b"PK\x03\x04 not an image", content_type="application/octet-stream")
    response = admin.post(f"{API}{template['id']}/background/", {"file": not_a_certificate}, format="multipart")
    assert response.status_code == 400 and "PDF, PNG or JPG" in response.json()["detail"]

    removed = admin.delete(f"{API}{template['id']}/background/").json()
    assert removed["background_image_url"] == ""


@pytest.mark.django_db
def test_the_active_template_is_used_for_issued_certificates(admin):
    provider, learner = _user("ct_provider"), _user("ct_learner2")
    program = TrainingProgram.objects.create(provider=provider, title="Lease Law", category=TrainingCategory.TENANT_LAW, issues_certification=True)
    TrainingEnrollment.objects.create(
        program=program, student=learner, status="COMPLETED", completed_at=timezone.now(),
        certificate_issued_at=timezone.now(), certificate_code="OZL-TEMPLATE23",
    )
    template = admin.post(API, {"name": "Portrait"}, format="json").json()
    layout = [
        {"type": "rect", "x": 0, "y": 0, "w": 1000, "h": 1414, "thickness": 30, "color": "#ff0000"},
        {"type": "text", "x": 100, "y": 600, "w": 800, "text": "{learner_name}", "size": 50, "font": "serif", "bold": True},
        {"type": "logo", "x": 450, "y": 100, "w": 100},
        {"type": "qr", "x": 450, "y": 1200, "w": 100},
    ]
    saved = admin.patch(f"{API}{template['id']}/", {"orientation": "PORTRAIT", "layout": layout}, format="json").json()
    assert saved["layout"][0]["color"] == "#FF0000"

    preview = admin.post(f"{API}{template['id']}/preview/", {"locale": "fr"}, format="json")
    assert preview.status_code == 200 and preview["Content-Type"] == "image/png"

    admin.post(f"{API}{template['id']}/activate/")
    assert APIClient().get("/api/certificates/OZL-TEMPLATE23/").json()["orientation"] == "PORTRAIT"
    image = Image.open(io.BytesIO(APIClient().get("/api/certificates/OZL-TEMPLATE23/image/").content)).convert("RGB")
    assert image.height > image.width and image.getpixel((3, image.height // 2)) == (255, 0, 0)
    assert APIClient().get("/api/certificates/OZL-TEMPLATE23/pdf/").content.startswith(b"%PDF-")

    # Activating another template replaces it; going back to the built-in design deactivates both.
    other = admin.post(f"{API}{template['id']}/duplicate/").json()
    admin.post(f"{API}{other['id']}/activate/")
    assert list(CertificateTemplate.objects.filter(is_active=True).values_list("id", flat=True)) == [CertificateTemplate.objects.get(pk=other["id"]).id]
    admin.post(f"{API}use-builtin/")
    assert not CertificateTemplate.objects.filter(is_active=True).exists()
    image = Image.open(io.BytesIO(APIClient().get("/api/certificates/OZL-TEMPLATE23/image/").content))
    assert image.width > image.height


@pytest.mark.django_db
def test_a_course_uses_its_own_certificate_template_before_the_default(admin):
    provider, lecturer, learner = _user("ct_provider3"), _user("ct_lecturer3"), _user("ct_learner3")
    program = TrainingProgram.objects.create(provider=provider, title="Lease Law", category=TrainingCategory.TENANT_LAW, issues_certification=True)
    CourseStaff.objects.create(program=program, user=lecturer, role=CourseStaffRole.LECTURER)
    TrainingEnrollment.objects.create(
        program=program, student=learner, status="COMPLETED", completed_at=timezone.now(),
        certificate_issued_at=timezone.now(), certificate_code="OZL-PERCOURSE2",
    )
    default = admin.post(API, {"name": "Landscape default"}, format="json").json()
    admin.post(f"{API}{default['id']}/activate/")
    own = admin.post(API, {"name": "Portrait for lease law"}, format="json").json()
    admin.patch(f"{API}{own['id']}/", {"orientation": "PORTRAIT"}, format="json")
    url = f"/api/manage/courses/{program.id}/certificate-template/"

    # Lecturers can see which design the course uses, but only admins choose it.
    seen = _client(lecturer).get(url).json()
    assert seen["template_id"] is None and seen["default"]["id"] == default["id"] and seen["can_change"] is False
    assert _client(lecturer).put(url, {"template_id": own["id"]}, format="json").status_code == 403
    assert admin.put(url, {"template_id": "not-a-template"}, format="json").status_code == 400

    assert admin.put(url, {"template_id": own["id"]}, format="json").json()["template_id"] == own["id"]
    assert admin.get(f"{API}{own['id']}/").json()["course_count"] == 1
    assert APIClient().get("/api/certificates/OZL-PERCOURSE2/").json()["orientation"] == "PORTRAIT"
    image = Image.open(io.BytesIO(APIClient().get("/api/certificates/OZL-PERCOURSE2/image/").content))
    assert image.height > image.width

    # Deleting the course's template falls back to the platform default.
    admin.delete(f"{API}{own['id']}/")
    assert admin.get(url).json()["template_id"] is None
    assert APIClient().get("/api/certificates/OZL-PERCOURSE2/").json()["orientation"] == "LANDSCAPE"


@pytest.mark.django_db
def test_issued_certificates_keep_their_design_when_templates_change(admin):
    from careers.services import enroll_in_training, mark_training_completed

    provider = _user("ct_provider4")
    program = TrainingProgram.objects.create(provider=provider, title="Lease Law", category=TrainingCategory.TENANT_LAW, issues_certification=True)
    template = admin.post(API, {"name": "Red portrait", "start_from": "empty"}, format="json").json()
    red_frame = [{"type": "rect", "x": 0, "y": 0, "w": 1000, "h": 1414, "thickness": 30, "color": "#FF0000"}]
    admin.patch(f"{API}{template['id']}/", {"orientation": "PORTRAIT", "layout": red_frame}, format="json")
    logo = SimpleUploadedFile("logo.png", _png((50, 50), "blue"), content_type="image/png")
    admin.post(f"{API}{template['id']}/logo/", {"file": logo}, format="multipart")
    admin.post(f"{API}{template['id']}/activate/")

    first = mark_training_completed(enroll_in_training(program=program, student=_user("ct_learner4")))
    second = mark_training_completed(enroll_in_training(program=program, student=_user("ct_learner5")))
    assert first.certificate_design_id == second.certificate_design_id  # identical designs share one snapshot
    assert first.certificate_design.logo and first.certificate_design.source_name == "Red portrait"

    # Editing, replacing the default and then deleting the template doesn't touch the issued certificate.
    admin.patch(f"{API}{template['id']}/", {"orientation": "LANDSCAPE", "layout": []}, format="json")
    other = admin.post(API, {"name": "Landscape"}, format="json").json()
    admin.post(f"{API}{other['id']}/activate/")
    admin.delete(f"{API}{template['id']}/")

    code = first.certificate_code
    assert APIClient().get(f"/api/certificates/{code}/").json()["orientation"] == "PORTRAIT"
    image = Image.open(io.BytesIO(APIClient().get(f"/api/certificates/{code}/image/").content)).convert("RGB")
    assert image.height > image.width and image.getpixel((3, image.height // 2)) == (255, 0, 0)

    # Certificates issued from now on use the new default.
    third = mark_training_completed(enroll_in_training(program=program, student=_user("ct_learner6")))
    assert third.certificate_design_id != first.certificate_design_id
    assert APIClient().get(f"/api/certificates/{third.certificate_code}/").json()["orientation"] == "LANDSCAPE"


@pytest.mark.django_db
def test_certificates_issued_before_freezing_are_frozen_with_their_current_design(admin):
    import importlib

    from django.apps import apps

    provider = _user("ct_provider7")
    program = TrainingProgram.objects.create(provider=provider, title="Lease Law", category=TrainingCategory.TENANT_LAW, issues_certification=True)
    legacy = TrainingEnrollment.objects.create(
        program=program, student=_user("ct_learner7"), status="COMPLETED", completed_at=timezone.now(),
        certificate_issued_at=timezone.now(), certificate_code="OZL-LEGACY2345",
    )
    template = admin.post(API, {"name": "Portrait"}, format="json").json()
    admin.patch(f"{API}{template['id']}/", {"orientation": "PORTRAIT"}, format="json")
    admin.post(f"{API}{template['id']}/activate/")

    importlib.import_module("careers.migrations.0014_certificate_designs").freeze_issued_certificates(apps, None)
    legacy.refresh_from_db()
    assert legacy.certificate_design.orientation == "PORTRAIT"
    admin.post(f"{API}use-builtin/")
    assert APIClient().get("/api/certificates/OZL-LEGACY2345/").json()["orientation"] == "PORTRAIT"


@pytest.mark.django_db
def test_a_drawn_or_uploaded_signature_is_trimmed_drawn_and_frozen(admin):
    from careers.services import enroll_in_training, mark_training_completed

    template = admin.post(API, {"name": "Signed", "start_from": "empty"}, format="json").json()
    layout = [{"type": "signature", "x": 100, "y": 100, "w": 200}]
    assert admin.patch(f"{API}{template['id']}/", {"layout": layout}, format="json").json()["layout"][0]["type"] == "signature"
    url = f"{API}{template['id']}/signature/"

    blank = Image.new("RGBA", (600, 200), (0, 0, 0, 0))
    buffer = io.BytesIO()
    blank.save(buffer, format="PNG")
    response = admin.post(url, {"file": SimpleUploadedFile("sig.png", buffer.getvalue(), "image/png")}, format="multipart")
    assert response.status_code == 400 and "empty" in response.json()["detail"]

    ink = Image.new("RGBA", (600, 200), (0, 0, 0, 0))
    ink.paste((0, 0, 255, 255), (200, 50, 400, 150))  # the ink, surrounded by transparent margins
    buffer = io.BytesIO()
    ink.save(buffer, format="PNG")
    saved = admin.post(url, {"file": SimpleUploadedFile("sig.png", buffer.getvalue(), "image/png")}, format="multipart").json()
    assert saved["signature_url"].endswith(".png")
    stored = CertificateTemplate.objects.get(pk=template["id"]).signature
    assert Image.open(stored.path).size == (200, 100)  # trimmed to the ink

    admin.post(f"{API}{template['id']}/activate/")
    program = TrainingProgram.objects.create(provider=_user("ct_provider8"), title="Lease Law", category=TrainingCategory.TENANT_LAW, issues_certification=True)
    enrollment = mark_training_completed(enroll_in_training(program=program, student=_user("ct_learner8")))
    assert enrollment.certificate_design.signature

    admin.delete(url)  # removing it from the template doesn't remove it from the issued certificate
    image = Image.open(io.BytesIO(APIClient().get(f"/api/certificates/{enrollment.certificate_code}/image/").content)).convert("RGB")
    scale = image.width / 1000
    assert image.getpixel((int(200 * scale), int(150 * scale))) == (0, 0, 255)  # the signature's middle


@pytest.mark.django_db
def test_certificates_carry_hours_final_grade_completion_and_expiry_dates(admin):
    from datetime import datetime
    from decimal import Decimal

    from careers.models import CourseModule, Lesson, LessonKind, LessonProgress, QuizAttempt
    from careers.services import add_months, enroll_in_training, mark_training_completed

    program = TrainingProgram.objects.create(
        provider=_user("ct_provider9"), title="Lease Law", category=TrainingCategory.TENANT_LAW, issues_certification=True,
        duration_hours=Decimal("7.5"), certificate_validity_months=24,
    )
    module = CourseModule.objects.create(program=program, title="Basics")
    quizzes = [Lesson.objects.create(module=module, title=f"Quiz {n}", kind=LessonKind.QUIZ) for n in (1, 2)]
    from careers.models import QuizQuestion
    for lesson in quizzes:
        QuizQuestion.objects.create(lesson=lesson, text="Q")
    enrollment = enroll_in_training(program=program, student=_user("ct_learner9"))
    for lesson, scores in zip(quizzes, [(60, 90), (80,)]):  # best scores 90 and 80
        for score in scores:
            QuizAttempt.objects.create(enrollment=enrollment, lesson=lesson, score_percent=score, passed=score >= 70)
        LessonProgress.objects.create(enrollment=enrollment, lesson=lesson)
    enrollment = mark_training_completed(enrollment)
    assert enrollment.certificate_grade_percent == 85 and enrollment.certificate_hours == Decimal("7.5")
    assert enrollment.certificate_expires_at == add_months(enrollment.certificate_issued_at, 24)

    # Changing the course afterwards doesn't change the issued certificate.
    TrainingProgram.objects.filter(pk=program.pk).update(duration_hours=40, certificate_validity_months=None)
    data = APIClient().get(f"/api/certificates/{enrollment.certificate_code}/").json()
    assert data["hours"] == 7.5 and data["grade_percent"] == 85 and data["is_expired"] is False and data["expires_at"]

    from careers.certificate_pdf import certificate_values
    enrollment.refresh_from_db()
    english, french = certificate_values(enrollment, "en"), certificate_values(enrollment, "fr")
    assert (english["course_hours"], english["final_grade"]) == ("7.5 hours", "85%")
    assert (french["course_hours"], french["final_grade"]) == ("7,5 heures", "85 %")
    assert english["expiry_date"] and english["completion_date"]

    TrainingEnrollment.objects.filter(pk=enrollment.pk).update(certificate_expires_at=timezone.now())
    assert APIClient().get(f"/api/certificates/{enrollment.certificate_code}/").json()["is_expired"] is True
    assert add_months(datetime(2027, 1, 31), 1) == datetime(2027, 2, 28)


@pytest.mark.django_db
def test_a_text_with_an_empty_field_is_left_out_of_the_certificate():
    from careers.certificate_templates import render, sample_values

    layout = clean_layout([{"type": "text", "x": 0, "y": 0, "w": 1000, "text": "Valid until {expiry_date}", "size": 200, "color": "#FF0000"}])
    template = CertificateTemplate(name="t", background_color="#FFFFFF", layout=layout)
    with_expiry = render(template, sample_values("en"))
    without_expiry = render(template, {**sample_values("en"), "expiry_date": ""})
    assert with_expiry.getcolors(10_000_000) != without_expiry.getcolors(10_000_000)
    assert without_expiry.getcolors(10_000_000) == [(without_expiry.width * without_expiry.height, (255, 255, 255))]


@pytest.mark.django_db
def test_layouts_are_validated():
    with pytest.raises(TemplateError):
        clean_layout([{"type": "script"}])
    with pytest.raises(TemplateError):
        clean_layout([{"type": "text", "color": "red"}])
    with pytest.raises(TemplateError):
        clean_layout([{"type": "text", "font": "comic"}])
    (element,) = clean_layout([{"type": "text", "x": 99999, "size": "12", "extra": "dropped"}])
    assert element["x"] == 1000 and element["size"] == 12 and "extra" not in element
