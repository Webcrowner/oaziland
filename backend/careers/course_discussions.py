"""
careers.course_discussions — each course's Q&A forum.

Enrolled learners (and those who finished) and the course's staff (provider, lecturers, supervisors, admins) can read
threads, start one (optionally about a specific lesson) and reply. Authors can edit their own posts; authors and staff
can delete them. Staff replies are marked so learners can spot the trainer's answer. New threads notify the course
staff; replies notify everyone already in the thread.
"""
from django.db import transaction
from django.utils import timezone

MAX_TITLE = 200
MAX_BODY = 5000
LEARNER_STATUSES = ("ENROLLED", "IN_PROGRESS", "COMPLETED")


class DiscussionError(Exception):
    pass


def is_course_staff(program, user) -> bool:
    from .course_services import manageable_programs
    if not (user and user.is_authenticated):
        return False
    return program.provider_id == user.pk or manageable_programs(user).filter(pk=program.pk).exists()


def can_participate(program, user) -> bool:
    from .models import TrainingEnrollment
    if not (user and user.is_authenticated):
        return False
    if is_course_staff(program, user):
        return True
    return TrainingEnrollment.objects.filter(program=program, student=user, status__in=LEARNER_STATUSES).exists()


def _staff_ids(program) -> set:
    from .models import CourseStaff
    return {program.provider_id, *CourseStaff.objects.filter(program=program).values_list("user_id", flat=True)}


def _clean(text: str, limit: int, label: str, required: bool = True) -> str:
    text = (text or "").strip()
    if required and not text:
        raise DiscussionError(f"Write a {label}.")
    if len(text) > limit:
        raise DiscussionError(f"The {label} must be {limit} characters or fewer.")
    return text


def _post_json(post, viewer, staff_ids: set, viewer_is_staff: bool) -> dict:
    author = post.author
    mine = bool(viewer and viewer.is_authenticated and author.pk == viewer.pk)
    return {
        "id": str(post.id), "title": post.title, "body": post.body,
        "author_name": author.full_name or author.username,
        "author_is_staff": author.pk in staff_ids,
        "lesson": {"id": str(post.lesson_id), "title": post.lesson.title} if post.lesson_id else None,
        "created_at": post.created_at, "edited_at": post.edited_at,
        "is_mine": mine, "can_edit": mine, "can_delete": mine or viewer_is_staff,
    }


def list_threads(program, viewer, *, lesson_id=None, query: str = "") -> dict:
    from django.db.models import Count, Q
    from .models import CourseDiscussionPost

    threads = (
        CourseDiscussionPost.objects.filter(program=program, parent__isnull=True)
        .select_related("author", "lesson", "program").annotate(reply_count=Count("replies"))
        .order_by("-last_activity_at")
    )
    if lesson_id:
        threads = threads.filter(lesson_id=lesson_id)
    if query.strip():
        q = query.strip()
        threads = threads.filter(Q(title__icontains=q) | Q(body__icontains=q) | Q(replies__body__icontains=q)).distinct()
    staff_ids = _staff_ids(program)
    viewer_is_staff = is_course_staff(program, viewer)
    staff_answered = set(
        CourseDiscussionPost.objects.filter(parent__in=threads, author_id__in=staff_ids).values_list("parent_id", flat=True)
    )
    results = []
    for thread in threads[:100]:
        item = _post_json(thread, viewer, staff_ids, viewer_is_staff)
        item.update({"reply_count": thread.reply_count, "last_activity_at": thread.last_activity_at,
                     "answered_by_staff": thread.id in staff_answered})
        results.append(item)
    return {"results": results, "is_staff": viewer_is_staff}


def thread_detail(thread, viewer) -> dict:
    staff_ids = _staff_ids(thread.program)
    viewer_is_staff = is_course_staff(thread.program, viewer)
    replies = thread.replies.select_related("author", "lesson", "program").order_by("created_at")
    return {
        **_post_json(thread, viewer, staff_ids, viewer_is_staff),
        "last_activity_at": thread.last_activity_at,
        "replies": [_post_json(reply, viewer, staff_ids, viewer_is_staff) for reply in replies],
    }


def create_thread(program, user, *, title: str, body: str, lesson_id=None):
    from .models import CourseDiscussionPost, Lesson
    if not can_participate(program, user):
        raise PermissionError("Only learners enrolled in this course can take part in its discussions.")
    title = _clean(title, MAX_TITLE, "title")
    body = _clean(body, MAX_BODY, "question")
    lesson = None
    if lesson_id:
        lesson = Lesson.objects.filter(pk=lesson_id, module__program=program).first()
        if lesson is None:
            raise DiscussionError("That lesson is not part of this course.")
    thread = CourseDiscussionPost.objects.create(program=program, author=user, lesson=lesson, title=title, body=body)
    _notify_new_thread(thread)
    return thread


def reply_to(thread, user, *, body: str):
    from .models import CourseDiscussionPost
    if not can_participate(thread.program, user):
        raise PermissionError("Only learners enrolled in this course can take part in its discussions.")
    body = _clean(body, MAX_BODY, "reply")
    with transaction.atomic():
        reply = CourseDiscussionPost.objects.create(program=thread.program, parent=thread, author=user, body=body)
        CourseDiscussionPost.objects.filter(pk=thread.pk).update(last_activity_at=reply.created_at)
    _notify_reply(thread, reply)
    return reply


def edit_post(post, user, *, body: str, title: str | None = None):
    if post.author_id != user.pk:
        raise PermissionError("Only the author can edit this post.")
    post.body = _clean(body, MAX_BODY, "message")
    fields = ["body", "edited_at"]
    if post.parent_id is None and title is not None:
        post.title = _clean(title, MAX_TITLE, "title")
        fields.append("title")
    post.edited_at = timezone.now()
    post.save(update_fields=fields)
    return post


def delete_post(post, user):
    if post.author_id != user.pk and not is_course_staff(post.program, user):
        raise PermissionError("Only the author or the course staff can delete this post.")
    post.delete()


def _notify_new_thread(thread):
    from .services import _in_language, _send
    author = thread.author.full_name or thread.author.username
    for user in _users(_staff_ids(thread.program) - {thread.author_id}):
        _send(
            recipient=user, notification_type="COURSE_DISCUSSION",
            title=_in_language(user, f"New question in \"{thread.program.title}\"", f"Nouvelle question dans « {thread.program.title} »"),
            message=_in_language(user, f"{author} asked: {thread.title}", f"{author} a demandé : {thread.title}"),
            related_reference=str(thread.program_id),
        )


def _notify_reply(thread, reply):
    from .services import _in_language, _send
    participants = {thread.author_id, *thread.replies.values_list("author_id", flat=True)} - {reply.author_id}
    author = reply.author.full_name or reply.author.username
    for user in _users(participants):
        _send(
            recipient=user, notification_type="COURSE_DISCUSSION",
            title=_in_language(user, f"New reply: {thread.title}", f"Nouvelle réponse : {thread.title}"),
            message=_in_language(user, f"{author} replied: {reply.body[:140]}", f"{author} a répondu : {reply.body[:140]}"),
            related_reference=str(thread.program_id),
        )


def _users(ids):
    from identity.models import User
    return User.objects.filter(pk__in=ids, is_active=True)
