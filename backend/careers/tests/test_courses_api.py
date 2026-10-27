"""Coursera-style courses: authoring permissions, staff assignment,
lesson/quiz progress and automatic completion."""
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from careers.models import (
    Lesson, LessonKind, TrainingCategory, TrainingEnrollmentStatus, TrainingProgram, CourseModule,
)


def _client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _user(name, **extra):
    return User.objects.create(username=name, phone=f"+2376{abs(hash(name)) % 10**8:08d}", **extra)


@pytest.fixture
def admin():
    return _user("c_admin", is_staff=True)


def _create_course(admin_client, **extra):
    payload = {"title": "Lease Law", "category": TrainingCategory.TENANT_LAW, "issues_certification": True, **extra}
    response = admin_client.post("/api/manage/courses/", payload, format="json")
    assert response.status_code == 201, response.data
    return response.data["id"]


def _quiz(client, module_id, pass_mark=60):
    lesson = client.post("/api/manage/lessons/", {"module": module_id, "title": "Quiz", "kind": "QUIZ", "pass_mark_percent": pass_mark}, format="json").data["id"]
    q = client.post("/api/manage/questions/", {
        "lesson": lesson, "text": "Pick the true statements", "explanation": "Because.",
        "choices": [{"text": "A", "is_correct": True}, {"text": "B", "is_correct": True}, {"text": "C", "is_correct": False}],
    }, format="json")
    assert q.status_code == 201, q.data
    return lesson, q.data


@pytest.mark.django_db
def test_only_admins_create_courses_and_assign_staff():
    admin = _user("c_admin", is_staff=True)
    user = _user("c_plain")
    lecturer = _user("c_lect")
    course_id = _create_course(_client(admin))

    assert _client(user).post("/api/manage/courses/", {"title": "X", "category": "OTHER"}, format="json").status_code == 403

    assign = _client(admin).post(f"/api/manage/courses/{course_id}/staff/", {"identifier": "C_LECT", "role": "LECTURER"}, format="json")
    assert assign.status_code == 201
    assert _client(admin).post(f"/api/manage/courses/{course_id}/staff/", {"identifier": "nobody", "role": "LECTURER"}, format="json").status_code == 400
    assert _client(lecturer).post(f"/api/manage/courses/{course_id}/staff/", {"identifier": "c_plain", "role": "SUPERVISOR"}, format="json").status_code == 403


@pytest.mark.django_db
def test_lecturer_edits_assigned_course_supervisor_cannot_and_outsiders_see_nothing():
    admin = _user("c_admin", is_staff=True)
    lecturer, supervisor, outsider = _user("c_lect"), _user("c_sup"), _user("c_out")
    course_id = _create_course(_client(admin))
    for user, role in ((lecturer, "LECTURER"), (supervisor, "SUPERVISOR")):
        _client(admin).post(f"/api/manage/courses/{course_id}/staff/", {"identifier": user.username, "role": role}, format="json")

    assert _client(lecturer).patch(f"/api/manage/courses/{course_id}/", {"title": "Renamed"}, format="json").status_code == 200
    module = _client(lecturer).post("/api/manage/modules/", {"program": course_id, "title": "M1"}, format="json")
    assert module.status_code == 201

    assert _client(supervisor).patch(f"/api/manage/courses/{course_id}/", {"title": "Nope"}, format="json").status_code == 403
    assert _client(supervisor).post("/api/manage/modules/", {"program": course_id, "title": "M2"}, format="json").status_code == 403
    assert _client(supervisor).get(f"/api/manage/courses/{course_id}/learners/").status_code == 200

    assert _client(outsider).get("/api/manage/courses/").data["count"] == 0
    assert _client(outsider).get(f"/api/manage/courses/{course_id}/learners/").status_code == 404
    assert _client(outsider).post("/api/manage/modules/", {"program": course_id, "title": "M3"}, format="json").status_code == 403


@pytest.mark.django_db
def test_quiz_validation_and_pdf_validation():
    admin = _user("c_admin", is_staff=True)
    client = _client(admin)
    course_id = _create_course(client)
    module = client.post("/api/manage/modules/", {"program": course_id, "title": "M"}, format="json").data["id"]
    text_lesson = client.post("/api/manage/lessons/", {"module": module, "title": "Read", "kind": "TEXT"}, format="json").data["id"]

    no_correct = client.post("/api/manage/questions/", {"lesson": text_lesson, "text": "?", "choices": [{"text": "a"}, {"text": "b"}]}, format="json")
    assert no_correct.status_code == 400  # not a quiz lesson / no correct choice

    quiz = client.post("/api/manage/lessons/", {"module": module, "title": "Q", "kind": "QUIZ"}, format="json").data["id"]
    assert client.post("/api/manage/questions/", {"lesson": quiz, "text": "?", "choices": [{"text": "a"}, {"text": "b"}]}, format="json").status_code == 400
    assert client.post("/api/manage/lessons/", {"module": module, "title": "V", "kind": "VIDEO"}, format="json").status_code == 400

    fake = SimpleUploadedFile("x.pdf", b"not a pdf", content_type="application/pdf")
    assert client.post("/api/manage/lessons/", {"module": module, "title": "P", "kind": "PDF", "pdf_file": fake}, format="multipart").status_code == 400
    real = SimpleUploadedFile("x.pdf", b"%PDF-1.4 test", content_type="application/pdf")
    ok = client.post("/api/manage/lessons/", {"module": module, "title": "P", "kind": "PDF", "pdf_file": real}, format="multipart")
    assert ok.status_code == 201 and ok.data["pdf_url"].endswith(".pdf")


@pytest.mark.django_db
def test_video_lesson_accepts_link_or_uploaded_file_and_learner_sees_both(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    admin, student = _user("c_admin", is_staff=True), _user("c_student")
    a, s = _client(admin), _client(student)
    course_id = _create_course(a)
    module = a.post("/api/manage/modules/", {"program": course_id, "title": "M"}, format="json").data["id"]

    link = a.post("/api/manage/lessons/", {"module": module, "title": "L", "kind": "VIDEO", "video_url": "https://youtu.be/abc"}, format="json")
    assert link.status_code == 201 and link.data["video_file_url"] == ""

    fake = SimpleUploadedFile("x.mp4", b"not a video at all", content_type="video/mp4")
    assert a.post("/api/manage/lessons/", {"module": module, "title": "F", "kind": "VIDEO", "video_file": fake}, format="multipart").status_code == 400
    wrong_type = SimpleUploadedFile("x.mp4", b"\x00\x00\x00\x18ftypmp42", content_type="text/plain")
    assert a.post("/api/manage/lessons/", {"module": module, "title": "F", "kind": "VIDEO", "video_file": wrong_type}, format="multipart").status_code == 400

    real = SimpleUploadedFile("x.mp4", b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 32, content_type="video/mp4")
    up = a.post("/api/manage/lessons/", {"module": module, "title": "F", "kind": "VIDEO", "video_file": real}, format="multipart")
    assert up.status_code == 201 and up.data["video_file_url"].endswith(".mp4")

    enrollment = s.post(f"/api/trainings/{course_id}/enroll/").data["id"]
    lessons = s.get(f"/api/my-enrollments/{enrollment}/course/").data["modules"][0]["lessons"]
    assert lessons[0]["video_url"] == "https://youtu.be/abc"
    assert lessons[1]["video_file_url"].endswith(".mp4")

    removed = a.patch(f"/api/manage/lessons/{up.data['id']}/", {"remove_video_file": "true"}, format="multipart")
    assert removed.status_code == 400  # a video lesson must keep a link or a file

    progress = s.get("/api/my-enrollments/").data["results"][0]["progress"]
    assert progress == {"total": 2, "done": 0, "percent": 0}


@pytest.mark.django_db
def test_learner_completes_course_through_lessons_and_quiz_and_gets_certificate():
    admin = _user("c_admin", is_staff=True)
    student = _user("c_student")
    a, s = _client(admin), _client(student)
    course_id = _create_course(a)
    module = a.post("/api/manage/modules/", {"program": course_id, "title": "M"}, format="json").data["id"]
    reading = a.post("/api/manage/lessons/", {"module": module, "title": "Read", "kind": "TEXT", "content_text": "hello"}, format="json").data["id"]
    quiz, question = _quiz(a, module)

    enrollment = s.post(f"/api/trainings/{course_id}/enroll/").data["id"]
    base = f"/api/my-enrollments/{enrollment}"

    # Manual completion is blocked while lessons remain.
    assert s.post(f"{base}/complete/").status_code == 409

    outline = s.get(f"{base}/course/").data
    lessons = outline["modules"][0]["lessons"]
    assert [l["title"] for l in lessons] == ["Read", "Quiz"]  # creation order is preserved
    quiz_json = lessons[1]
    assert all("is_correct" not in c for c in quiz_json["questions"][0]["choices"])  # answers never leak
    assert quiz_json["questions"][0]["multiple"] is True

    assert s.post(f"{base}/lessons/{quiz}/complete/").status_code == 409  # quizzes are passed, not ticked
    done = s.post(f"{base}/lessons/{reading}/complete/")
    assert done.data["status"] == TrainingEnrollmentStatus.IN_PROGRESS
    assert done.data["progress"]["percent"] == 50

    choices = {c["text"]: c["id"] for c in question["choices"]}
    wrong = s.post(f"{base}/quizzes/{quiz}/submit/", {"answers": {question["id"]: [choices["A"]]}}, format="json")
    assert wrong.data["passed"] is False and wrong.data["score_percent"] == 0  # partial selection is wrong
    assert wrong.data["status"] == TrainingEnrollmentStatus.IN_PROGRESS

    right = s.post(f"{base}/quizzes/{quiz}/submit/", {"answers": {question["id"]: [choices["A"], choices["B"]]}}, format="json")
    assert right.data["passed"] is True and right.data["score_percent"] == 100
    assert right.data["status"] == TrainingEnrollmentStatus.COMPLETED

    enrollment_row = s.get(base + "/").data
    assert enrollment_row["certificate_issued_at"] is not None
    assert s.post(f"{base}/lessons/{reading}/complete/").status_code == 409  # finished courses are frozen

    rows = a.get(f"/api/manage/courses/{course_id}/learners/").data
    assert rows[0]["progress_percent"] == 100
    assert rows[0]["quizzes"][0]["attempts"] == 2 and rows[0]["quizzes"][0]["best_score_percent"] == 100


@pytest.mark.django_db
def test_assignment_submission_review_resubmission_and_file_privacy():
    admin = _user("c_admin", is_staff=True)
    supervisor, student, other, outsider = _user("c_sup"), _user("c_student"), _user("c_other"), _user("c_out")
    a, sup, s, o, out = _client(admin), _client(supervisor), _client(student), _client(other), _client(outsider)
    course_id = _create_course(a)
    a.post(f"/api/manage/courses/{course_id}/staff/", {"identifier": "c_sup", "role": "SUPERVISOR"}, format="json")
    module = a.post("/api/manage/modules/", {"program": course_id, "title": "M"}, format="json").data["id"]
    task = a.post("/api/manage/lessons/", {"module": module, "title": "Report", "kind": "ASSIGNMENT", "content_text": "Write it"}, format="json").data["id"]

    enrollment = s.post(f"/api/trainings/{course_id}/enroll/").data["id"]
    o.post(f"/api/trainings/{course_id}/enroll/")
    base = f"/api/my-enrollments/{enrollment}"

    assert s.post(f"{base}/lessons/{task}/complete/").status_code == 409  # can't self-tick an assignment
    bad = SimpleUploadedFile("r.pdf", b"not a pdf", content_type="application/pdf")
    assert s.post(f"{base}/assignments/{task}/submit/", {"file": bad}, format="multipart").status_code == 400
    assert s.post(f"{base}/assignments/{task}/submit/", {}, format="multipart").status_code == 400

    pdf = SimpleUploadedFile("r.pdf", b"%PDF-1.4 first", content_type="application/pdf")
    assert s.post(f"{base}/assignments/{task}/submit/", {"file": pdf}, format="multipart").status_code == 201
    outline = s.get(f"{base}/course/").data["modules"][0]["lessons"][0]
    assert outline["submission"]["status"] == "SUBMITTED" and "file" not in outline["submission"]

    queue = sup.get(f"/api/manage/courses/{course_id}/submissions/").data
    assert len(queue) == 1 and queue[0]["student_name"] is not None
    submission_id = queue[0]["id"]

    # Only the submitter and course staff can download the PDF.
    assert s.get(f"{base}/assignments/{task}/file/")["Content-Type"] == "application/pdf"
    assert sup.get(f"/api/manage/courses/{course_id}/submissions/{submission_id}/file/").status_code == 200
    assert o.get(f"{base}/assignments/{task}/file/").status_code == 404  # another learner's enrollment id
    assert out.get(f"/api/manage/courses/{course_id}/submissions/{submission_id}/file/").status_code == 404
    assert out.get(f"/api/manage/courses/{course_id}/submissions/").status_code == 404

    review_url = f"/api/manage/courses/{course_id}/submissions/{submission_id}/review/"
    assert s.post(review_url, {"decision": "APPROVED"}, format="json").status_code == 404  # learners can't review
    assert sup.post(review_url, {"decision": "CHANGES_REQUESTED"}, format="json").status_code == 400  # needs feedback
    assert sup.post(review_url, {"decision": "MAYBE"}, format="json").status_code == 400
    assert sup.post(review_url, {"decision": "CHANGES_REQUESTED", "feedback": "Add figures"}, format="json").status_code == 200

    outline = s.get(f"{base}/course/").data["modules"][0]["lessons"][0]
    assert outline["submission"]["status"] == "CHANGES_REQUESTED" and outline["submission"]["feedback"] == "Add figures"
    assert outline["completed"] is False

    pdf2 = SimpleUploadedFile("r2.pdf", b"%PDF-1.4 second", content_type="application/pdf")
    assert s.post(f"{base}/assignments/{task}/submit/", {"file": pdf2}, format="multipart").status_code == 201
    assert sup.get(f"/api/manage/courses/{course_id}/submissions/?status=SUBMITTED").data[0]["feedback"] == ""

    assert sup.post(review_url, {"decision": "APPROVED", "feedback": "Great"}, format="json").status_code == 200
    final = s.get(f"{base}/course/").data
    assert final["status"] == TrainingEnrollmentStatus.COMPLETED  # the only lesson was approved
    assert final["certificate_issued_at"] is not None

    again = SimpleUploadedFile("r3.pdf", b"%PDF-1.4 third", content_type="application/pdf")
    assert s.post(f"{base}/assignments/{task}/submit/", {"file": again}, format="multipart").status_code == 409


def _assignment_setup(student_language="EN"):
    admin = _user("c_admin", is_staff=True)
    supervisor = _user("c_sup")
    student = _user("c_student", preferred_language=student_language)
    a = _client(admin)
    course_id = _create_course(a)
    a.post(f"/api/manage/courses/{course_id}/staff/", {"identifier": "c_sup", "role": "SUPERVISOR"}, format="json")
    module = a.post("/api/manage/modules/", {"program": course_id, "title": "M"}, format="json").data["id"]
    task = a.post("/api/manage/lessons/", {"module": module, "title": "Report", "kind": "ASSIGNMENT"}, format="json").data["id"]
    s = _client(student)
    enrollment = s.post(f"/api/trainings/{course_id}/enroll/").data["id"]
    pdf = SimpleUploadedFile("r.pdf", b"%PDF-1.4 x", content_type="application/pdf")
    s.post(f"/api/my-enrollments/{enrollment}/assignments/{task}/submit/", {"file": pdf}, format="multipart")
    submission_id = _client(supervisor).get(f"/api/manage/courses/{course_id}/submissions/").data[0]["id"]
    return student, _client(supervisor), f"/api/manage/courses/{course_id}/submissions/{submission_id}/review/"


@pytest.mark.django_db
def test_learner_is_notified_when_an_assignment_is_reviewed():
    from notifications.models import Notification

    student, sup, review_url = _assignment_setup()
    assert Notification.objects.filter(recipient=student).count() == 0  # submitting alone doesn't notify the learner

    sup.post(review_url, {"decision": "CHANGES_REQUESTED", "feedback": "Add a conclusion"}, format="json")
    first = Notification.objects.get(recipient=student, notification_type="COURSE_ASSIGNMENT_REVIEW")
    assert first.title.startswith("Changes requested") and "Add a conclusion" in first.message

    sup.post(review_url, {"decision": "APPROVED"}, format="json")
    titles = list(Notification.objects.filter(recipient=student).order_by("created_at").values_list("title", flat=True))
    assert titles[-1].startswith("Assignment approved") and len(titles) == 2


@pytest.mark.django_db
def test_review_notification_uses_the_learners_language():
    from notifications.models import Notification

    student, sup, review_url = _assignment_setup(student_language="FR")
    sup.post(review_url, {"decision": "APPROVED"}, format="json")
    assert Notification.objects.get(recipient=student).title.startswith("Devoir approuvé")


@pytest.mark.django_db
def test_a_notification_failure_does_not_block_the_review(monkeypatch):
    import notifications.services as notification_services

    def boom(**kwargs):
        raise RuntimeError("provider down")

    monkeypatch.setattr(notification_services, "notify", boom)
    student, sup, review_url = _assignment_setup()
    response = sup.post(review_url, {"decision": "APPROVED"}, format="json")
    assert response.status_code == 200 and response.data["status"] == "APPROVED"


@pytest.mark.django_db
def test_other_students_cannot_touch_my_enrollment_and_drafts_are_hidden():
    admin = _user("c_admin", is_staff=True)
    a, s1, s2 = _client(admin), _client(_user("c_s1")), _client(_user("c_s2"))
    course_id = _create_course(a, is_published=False)

    assert APIClient().get("/api/trainings/").data["count"] == 0
    assert s1.post(f"/api/trainings/{course_id}/enroll/").status_code == 404
    assert a.get("/api/trainings/").data["count"] == 1  # admins still see drafts

    a.patch(f"/api/manage/courses/{course_id}/", {"is_published": True}, format="json")
    enrollment = s1.post(f"/api/trainings/{course_id}/enroll/").data["id"]
    assert s2.get(f"/api/my-enrollments/{enrollment}/course/").status_code == 404
