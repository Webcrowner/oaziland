"""Coursera-style extras: suggested deadlines, free preview lessons, short-answer and number quiz questions, and
peer review of assignments."""
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from careers.course_reminders import overdue_module_titles
from careers.course_services import normalise_text, parse_number
from careers.models import (
    AssignmentSubmission, CourseModule, Lesson, PeerReview, QuizQuestion, TrainingEnrollment, TrainingProgram,
)
from identity.models import User


def _client(user=None):
    client = APIClient()
    if user is not None:
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _user(name, **extra):
    return User.objects.create(username=name, phone=f"+2376{abs(hash(name)) % 10**8:08d}", **extra)


def _pdf(content=b"first"):
    return SimpleUploadedFile("work.pdf", b"%PDF-1.4 " + content, content_type="application/pdf")


@pytest.fixture(autouse=True)
def _remove_uploaded_files():
    yield
    for model, fields in ((AssignmentSubmission, ["file"]), (Lesson, ["pdf_file", "video_file"])):
        for row in model.objects.all():
            for field in fields:
                if getattr(row, field):
                    getattr(row, field).delete(save=False)


@pytest.fixture
def admin():
    return _user("p_admin", is_staff=True)


@pytest.fixture
def course(admin):
    return TrainingProgram.objects.create(provider=admin, title="Pacing", category="OTHER", is_published=True)


def _module(course, title="M1", **extra):
    return CourseModule.objects.create(program=course, title=title, position=course.modules.count(), **extra)


def _lesson(module, title="L", kind="TEXT", **extra):
    return Lesson.objects.create(module=module, title=title, kind=kind, position=module.lessons.count(), **extra)


def _enroll(course, user):
    response = _client(user).post(f"/api/trainings/{course.id}/enroll/")
    assert response.status_code == 201, response.data
    return response.data["id"]


def _question(admin, lesson, **payload):
    return _client(admin).post("/api/manage/questions/", {"lesson": str(lesson.id), "text": "Q?", **payload}, format="json")


def _quiz_with(admin, course, **payload):
    lesson = _lesson(_module(course), "Quiz", "QUIZ", pass_mark_percent=100)
    response = _question(admin, lesson, **payload)
    assert response.status_code == 201, response.data
    return lesson, response.data


# --- short-answer and number questions --------------------------------------------------------------------------

@pytest.mark.django_db  # the autouse cleanup fixture reads the database
def test_text_and_number_helpers_forgive_formatting():
    assert normalise_text("  Yaoundé  ") == normalise_text("yaounde") == "yaounde"
    assert normalise_text("Un   BAIL") == "un bail"
    assert parse_number("1500") == 1500
    assert parse_number("1 500") == 1500
    assert parse_number("1\u00a0500,5") == parse_number("1500.5")
    assert parse_number("1.500,5") == parse_number("1,500.5") == parse_number("1500.5")
    assert parse_number("abc") is None and parse_number("NaN") is None and parse_number("") is None


@pytest.mark.django_db
def test_short_answer_question_accepts_any_listed_answer_and_hides_them_until_passed(admin, course):
    learner = _user("p_learner")
    lesson, question = _quiz_with(admin, course, kind="SHORT_TEXT", accepted_answers=["Yaoundé", "Yaounde city"], explanation="The capital.")
    enrollment = _enroll(course, learner)
    base = f"/api/my-enrollments/{enrollment}"

    shown = _client(learner).get(f"{base}/course/").data["modules"][0]["lessons"][0]["questions"][0]
    assert shown["kind"] == "SHORT_TEXT" and shown["choices"] == [] and "accepted_answers" not in shown

    wrong = _client(learner).post(f"{base}/quizzes/{lesson.id}/submit/", {"answers": {question["id"]: ["Douala"]}}, format="json").data
    assert wrong["passed"] is False and wrong["results"] == [{"question": question["id"], "correct": False}]

    right = _client(learner).post(f"{base}/quizzes/{lesson.id}/submit/", {"answers": {question["id"]: ["  YAOUNDE CITY "]}}, format="json").data
    assert right["passed"] is True
    assert right["results"][0]["correct"] is True and right["results"][0]["correct_answers"] == ["Yaoundé", "Yaounde city"]
    review = _client(learner).get(f"{base}/course/").data["modules"][0]["lessons"][0]["review"]
    assert review["answers"][question["id"]] == ["YAOUNDE CITY"]


@pytest.mark.django_db
def test_number_question_is_right_within_its_tolerance(admin, course):
    learner = _user("p_learner")
    lesson, question = _quiz_with(admin, course, kind="NUMBER", accepted_answers=["150000"], tolerance="500")
    enrollment = _enroll(course, learner)
    submit = lambda value: _client(learner).post(
        f"/api/my-enrollments/{enrollment}/quizzes/{lesson.id}/submit/", {"answers": {question["id"]: [value]}}, format="json",
    ).data

    assert submit("not a number")["passed"] is False
    assert submit("151 000")["passed"] is False
    assert submit("149500,00")["passed"] is True  # exactly on the edge of the tolerance


@pytest.mark.django_db
def test_quiz_can_mix_question_kinds_and_scores_each_one(admin, course):
    learner = _user("p_learner")
    lesson = _lesson(_module(course), "Mixed", "QUIZ", pass_mark_percent=50)
    choice = _question(admin, lesson, choices=[{"text": "Yes", "is_correct": True}, {"text": "No", "is_correct": False}]).data
    text = _question(admin, lesson, kind="SHORT_TEXT", accepted_answers=["bail"]).data
    enrollment = _enroll(course, learner)
    yes = next(c["id"] for c in QuizQuestion.objects.get(pk=choice["id"]).choices.values("id", "is_correct") if c["is_correct"])

    result = _client(learner).post(
        f"/api/my-enrollments/{enrollment}/quizzes/{lesson.id}/submit/",
        {"answers": {choice["id"]: [str(yes)], text["id"]: ["lease"]}}, format="json",
    ).data
    assert result["score_percent"] == 50 and result["passed"] is True


@pytest.mark.django_db
def test_authors_must_give_valid_answers_for_each_question_kind(admin, course):
    lesson = _lesson(_module(course), "Q", "QUIZ")
    assert _question(admin, lesson, kind="SHORT_TEXT").status_code == 400
    assert _question(admin, lesson, kind="SHORT_TEXT", accepted_answers=[]).status_code == 400
    assert _question(admin, lesson, kind="NUMBER", accepted_answers=["many"]).status_code == 400
    assert _question(admin, lesson, kind="NUMBER", accepted_answers=["12"], tolerance="-1").status_code == 400
    assert _question(admin, lesson, choices=[{"text": "only", "is_correct": True}]).status_code == 400  # still needs two

    number = _question(admin, lesson, kind="NUMBER", accepted_answers=["12", "13"], tolerance="0.5")
    assert number.status_code == 201 and number.data["accepted_answers"] == ["12"] and number.data["choices"] == []

    # Turning a multiple-choice question into a text one drops its choices; turning it back needs new choices.
    choice = _question(admin, lesson, choices=[{"text": "a", "is_correct": True}, {"text": "b", "is_correct": False}]).data["id"]
    to_text = _client(admin).patch(f"/api/manage/questions/{choice}/", {"kind": "SHORT_TEXT", "accepted_answers": ["a"]}, format="json")
    assert to_text.status_code == 200 and to_text.data["choices"] == []
    assert _client(admin).patch(f"/api/manage/questions/{choice}/", {"kind": "CHOICE"}, format="json").status_code == 400


# --- suggested deadlines -----------------------------------------------------------------------------------------

@pytest.mark.django_db
def test_modules_get_a_suggested_finish_date_and_flag_when_the_learner_is_behind(admin, course):
    learner = _user("p_learner")
    first, second, unpaced = _module(course, "First", due_after_days=7), _module(course, "Second", due_after_days=14), _module(course, "Open")
    lesson_a, _lesson_b, _lesson_c = _lesson(first, "A"), _lesson(second, "B"), _lesson(unpaced, "C")
    enrollment_id = _enroll(course, learner)
    TrainingEnrollment.objects.filter(pk=enrollment_id).update(enrolled_at=timezone.now() - timedelta(days=10))
    base = f"/api/my-enrollments/{enrollment_id}"

    outline = _client(learner).get(f"{base}/course/").data
    first_out, second_out, open_out = outline["modules"]
    assert first_out["overdue"] is True and second_out["overdue"] is False and open_out["due_at"] is None and open_out["overdue"] is False
    assert first_out["due_after_days"] == 7 and outline["overdue_modules"] == 1

    enrollment = TrainingEnrollment.objects.get(pk=enrollment_id)
    assert overdue_module_titles(enrollment, timezone.now()) == ["First"]

    assert _client(learner).post(f"{base}/lessons/{lesson_a.id}/complete/").status_code == 200  # catching up clears it
    assert _client(learner).get(f"{base}/course/").data["overdue_modules"] == 0
    assert overdue_module_titles(enrollment, timezone.now()) == []


@pytest.mark.django_db
def test_authors_set_a_module_pace_between_one_day_and_two_years(admin, course):
    module = _module(course)
    url = f"/api/manage/modules/{module.id}/"
    assert _client(admin).patch(url, {"due_after_days": 14}, format="json").data["due_after_days"] == 14
    assert _client(admin).patch(url, {"due_after_days": 0}, format="json").status_code == 400
    assert _client(admin).patch(url, {"due_after_days": 5000}, format="json").status_code == 400
    assert _client(admin).patch(url, {"due_after_days": None}, format="json").data["due_after_days"] is None


# --- free preview ------------------------------------------------------------------------------------------------

@pytest.mark.django_db
def test_preview_lists_only_free_readings_videos_and_pdfs_to_anyone(admin, course):
    module = _module(course)
    _lesson(module, "Free reading", "TEXT", content_text="Hello", is_preview=True)
    _lesson(module, "Paid reading", "TEXT", content_text="Secret")
    _lesson(module, "Free video", "VIDEO", video_url="https://youtu.be/abc", is_preview=True)

    shown = _client().get(f"/api/trainings/{course.id}/preview/")  # no sign-in
    assert shown.status_code == 200
    assert [lesson["title"] for lesson in shown.data] == ["Free reading", "Free video"]
    assert shown.data[0]["content_text"] == "Hello" and shown.data[0]["module_title"] == "M1"

    syllabus = _client().get(f"/api/trainings/{course.id}/").data["syllabus"][0]["lessons"]
    assert [lesson["is_preview"] for lesson in syllabus] == [True, False, True]
    assert "content_text" not in syllabus[0]  # the public syllabus still only lists titles


@pytest.mark.django_db
def test_quizzes_and_assignments_cannot_be_previews_and_drafts_have_no_public_preview(admin, course):
    module = _module(course)
    quiz = _client(admin).post("/api/manage/lessons/", {"module": str(module.id), "title": "Q", "kind": "QUIZ", "is_preview": True}, format="json")
    assert quiz.status_code == 201 and quiz.data["is_preview"] is False
    task = _client(admin).post("/api/manage/lessons/", {"module": str(module.id), "title": "T", "kind": "ASSIGNMENT", "is_preview": True}, format="json")
    assert task.data["is_preview"] is False
    reading = _client(admin).post("/api/manage/lessons/", {"module": str(module.id), "title": "R", "kind": "TEXT", "is_preview": True}, format="json")
    assert reading.data["is_preview"] is True
    # Switching the lesson to a quiz clears the flag instead of leaving a hidden preview behind.
    switched = _client(admin).patch(f"/api/manage/lessons/{reading.data['id']}/", {"kind": "QUIZ"}, format="json")
    assert switched.data["is_preview"] is False

    course.is_published = False
    course.save(update_fields=["is_published"])
    assert _client().get(f"/api/trainings/{course.id}/preview/").status_code == 404


@pytest.mark.django_db
def test_a_preview_lessons_uploaded_pdf_opens_for_visitors_but_other_lessons_stay_private(admin, course):
    module = _module(course)
    free = _lesson(module, "Free", "PDF", is_preview=True, pdf_file=_pdf(b"free"))
    locked = _lesson(module, "Locked", "PDF", pdf_file=_pdf(b"locked"))

    link = _client().get(f"/api/trainings/{course.id}/preview/").data[0]["pdf_url"]
    opened = _client().get(link)  # a signed-out visitor
    assert link and opened.status_code == 200 and opened["Content-Type"] == "application/pdf"
    opened.close()

    from careers.course_media import media_url
    assert media_url(None, locked, "pdf", None) == ""  # no link is ever issued to a visitor for a locked lesson
    stranger = _user("p_stranger")
    stranger_link = media_url(None, locked, "pdf", stranger)
    assert _client(stranger).get(stranger_link).status_code == 404  # signed in but not enrolled
    assert free.is_preview and not locked.is_preview


# --- peer review ---------------------------------------------------------------------------------------------------

@pytest.fixture
def peer_task(admin, course):
    return _lesson(_module(course), "Report", "ASSIGNMENT", peer_review=True)


def _hand_in(course, task, user, content=b"first"):
    enrollment = _enroll(course, user)
    response = _client(user).post(f"/api/my-enrollments/{enrollment}/assignments/{task.id}/submit/", {"file": _pdf(content)}, format="multipart")
    assert response.status_code == 201, response.data
    return enrollment, AssignmentSubmission.objects.get(enrollment_id=enrollment, lesson=task)


def _review(user, enrollment, submission, decision="APPROVED", feedback=""):
    return _client(user).post(
        f"/api/my-enrollments/{enrollment}/peer/{submission.id}/review/", {"decision": decision, "feedback": feedback}, format="json",
    )


@pytest.mark.django_db
def test_two_approving_classmates_approve_the_work_and_finish_the_lesson(course, peer_task):
    author, first, second = _user("p_author"), _user("p_first"), _user("p_second")
    author_enrollment, submission = _hand_in(course, peer_task, author, b"author")
    first_enrollment, _ = _hand_in(course, peer_task, first, b"first")
    second_enrollment, _ = _hand_in(course, peer_task, second, b"second")

    assert _review(first, first_enrollment, submission, feedback="Clear and complete").status_code == 201
    submission.refresh_from_db()
    assert submission.status == "SUBMITTED"  # one review isn't enough yet

    assert _review(second, second_enrollment, submission).status_code == 201
    submission.refresh_from_db()
    assert submission.status == "APPROVED" and submission.reviewed_by is None and "Clear and complete" in submission.feedback
    assert _client(author).get(f"/api/my-enrollments/{author_enrollment}/course/").data["progress"]["done"] == 1

    from notifications.models import Notification
    assert Notification.objects.filter(recipient=author, notification_type="COURSE_ASSIGNMENT_REVIEW").count() == 1


@pytest.mark.django_db
def test_one_classmate_asking_for_changes_sends_the_work_back_with_their_comment(course, peer_task):
    author, first, second = _user("p_author"), _user("p_first"), _user("p_second")
    _, submission = _hand_in(course, peer_task, author, b"author")
    first_enrollment, _ = _hand_in(course, peer_task, first, b"first")
    second_enrollment, _ = _hand_in(course, peer_task, second, b"second")

    assert _review(first, first_enrollment, submission, "CHANGES_REQUESTED", "too short").status_code == 409  # a few words are needed
    assert _review(first, first_enrollment, submission, "CHANGES_REQUESTED", "Add the meter readings please").status_code == 201
    assert _review(second, second_enrollment, submission).status_code == 201
    submission.refresh_from_db()
    assert submission.status == "CHANGES_REQUESTED" and "Add the meter readings" in submission.feedback


@pytest.mark.django_db
def test_peer_review_rules_nobody_reviews_their_own_work_twice_or_before_handing_in(course, peer_task):
    author, other, newcomer = _user("p_author"), _user("p_other"), _user("p_newcomer")
    author_enrollment, submission = _hand_in(course, peer_task, author, b"author")
    other_enrollment, _ = _hand_in(course, peer_task, other, b"other")
    newcomer_enrollment = _enroll(course, newcomer)

    assert _review(author, author_enrollment, submission).status_code == 409  # own work
    assert _review(newcomer, newcomer_enrollment, submission).status_code == 409  # hasn't handed in yet
    assert _client(newcomer).get(f"/api/my-enrollments/{newcomer_enrollment}/peer/{submission.id}/file/").status_code == 404

    assert _review(other, other_enrollment, submission).status_code == 201
    assert _review(other, other_enrollment, submission).status_code == 409  # twice
    assert _review(other, other_enrollment, submission, "MAYBE").status_code == 409
    assert PeerReview.objects.filter(submission=submission).count() == 1


@pytest.mark.django_db
def test_review_queue_is_anonymous_and_skips_own_and_already_reviewed_work(course, peer_task):
    author, other, third = _user("p_author"), _user("p_other"), _user("p_third")
    _, author_sub = _hand_in(course, peer_task, author, b"author")
    other_enrollment, other_sub = _hand_in(course, peer_task, other, b"other")
    third_enrollment, third_sub = _hand_in(course, peer_task, third, b"third")

    queue = _client(other).get(f"/api/my-enrollments/{other_enrollment}/assignments/{peer_task.id}/peer/").data
    assert queue["required"] == 2
    assert {item["id"] for item in queue["items"]} == {str(author_sub.id), str(third_sub.id)}  # not their own
    assert all(set(item) == {"id", "submitted_at", "reviews"} for item in queue["items"])  # no names

    assert _review(other, other_enrollment, author_sub).status_code == 201
    after = _client(other).get(f"/api/my-enrollments/{other_enrollment}/assignments/{peer_task.id}/peer/").data
    assert {item["id"] for item in after["items"]} == {str(third_sub.id)}

    for who, enrollment, target in ((other, other_enrollment, third_sub), (third, third_enrollment, other_sub)):
        opened = _client(who).get(f"/api/my-enrollments/{enrollment}/peer/{target.id}/file/")
        assert opened.status_code == 200
        opened.close()  # the PDF is streamed from disk; release it so the test's cleanup can delete it


@pytest.mark.django_db
def test_peer_review_is_only_for_lessons_that_turn_it_on(course):
    plain = _lesson(_module(course), "Plain", "ASSIGNMENT")
    author, other = _user("p_author"), _user("p_other")
    _, submission = _hand_in(course, plain, author)
    other_enrollment, _ = _hand_in(course, plain, other, b"other")
    assert _review(other, other_enrollment, submission).status_code == 409
    assert _client(other).get(f"/api/my-enrollments/{other_enrollment}/assignments/{plain.id}/peer/").status_code == 409


@pytest.mark.django_db
def test_resubmitting_discards_the_old_reviews_and_staff_can_still_decide(admin, course, peer_task):
    author, other = _user("p_author"), _user("p_other")
    author_enrollment, submission = _hand_in(course, peer_task, author, b"author")
    other_enrollment, _ = _hand_in(course, peer_task, other, b"other")
    _review(other, other_enrollment, submission, "CHANGES_REQUESTED", "Please add the photos")
    assert PeerReview.objects.filter(submission=submission).count() == 1

    staff_view = _client(admin).get(f"/api/manage/courses/{course.id}/submissions/").data
    mine = next(row for row in staff_view if row["id"] == str(submission.id))
    assert mine["peer_review"] is True and mine["peer_reviews"] == [{"decision": "CHANGES_REQUESTED", "feedback": "Please add the photos"}]

    again = _client(author).post(f"/api/my-enrollments/{author_enrollment}/assignments/{peer_task.id}/submit/", {"file": _pdf(b"fixed")}, format="multipart")
    assert again.status_code == 201
    assert PeerReview.objects.filter(submission=submission).count() == 0

    decided = _client(admin).post(
        f"/api/manage/courses/{course.id}/submissions/{submission.id}/review/", {"decision": "APPROVED"}, format="json",
    )
    assert decided.status_code == 200
    submission.refresh_from_db()
    assert submission.status == "APPROVED" and submission.reviewed_by == admin
    assert _review(other, other_enrollment, submission).status_code == 409  # already decided


@pytest.mark.django_db
def test_staff_are_not_pinged_straight_away_for_peer_reviewed_work(admin, course, peer_task):
    from notifications.models import Notification
    _hand_in(course, peer_task, _user("p_author"))
    assert not Notification.objects.filter(recipient=admin, notification_type="COURSE_SUBMISSION_TO_REVIEW").exists()

    plain = _lesson(_module(course, "M2"), "Plain", "ASSIGNMENT")
    _hand_in(course, plain, _user("p_other"))
    assert Notification.objects.filter(recipient=admin, notification_type="COURSE_SUBMISSION_TO_REVIEW").count() == 1
