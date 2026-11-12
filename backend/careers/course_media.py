"""
careers.course_media — lesson videos and PDFs uploaded by course staff are private files.

They're served only through short-lived signed links (`/api/course-media/<token>/`) handed out in the course outline
to enrolled learners and course staff. A <video> or a PDF tab can't send the login token, so the signature carries
who the link was issued to, and access is re-checked on every request: a learner who drops the course or whose
payment is refunded loses access as soon as their link is used again, and a link stops working after a few hours.
"""
import mimetypes
import re

from django.core import signing
from django.http import FileResponse, Http404, HttpResponse, StreamingHttpResponse
from django.urls import reverse

SALT = "careers.course-media"
MAX_AGE_SECONDS = 6 * 60 * 60
FIELDS = {"video": "video_file", "pdf": "pdf_file"}
ACCESS_STATUSES = ("ENROLLED", "IN_PROGRESS", "COMPLETED")
CHUNK = 512 * 1024


def media_url(request, lesson, kind: str, user) -> str:
    """A signed link to the lesson's uploaded `kind` ("video" or "pdf") for user, or "" if there's no such file."""
    if not getattr(lesson, FIELDS[kind]) or not (user and user.is_authenticated):
        return ""
    token = signing.dumps({"l": str(lesson.pk), "k": kind, "u": str(user.pk)}, salt=SALT, compress=True)
    url = reverse("course-media", args=[token])
    return request.build_absolute_uri(url) if request is not None else url


def may_access(user, lesson) -> bool:
    from .course_services import manageable_programs
    from .models import TrainingEnrollment

    program_id = lesson.module.program_id
    if manageable_programs(user).filter(pk=program_id).exists():
        return True
    return TrainingEnrollment.objects.filter(program_id=program_id, student=user, status__in=ACCESS_STATUSES).exists()


def _chunks(handle, remaining: int):
    try:
        while remaining > 0:
            data = handle.read(min(CHUNK, remaining))
            if not data:
                break
            remaining -= len(data)
            yield data
    finally:
        handle.close()


def file_response(request, field_file):
    """Serves field_file inline, honouring a single `Range: bytes=…` request so videos can seek."""
    size = field_file.size
    content_type = mimetypes.guess_type(field_file.name)[0] or "application/octet-stream"
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", request.META.get("HTTP_RANGE", "").strip())
    handle = field_file.open("rb")
    if match and (match.group(1) or match.group(2)):
        if match.group(1):
            start = int(match.group(1))
            end = min(int(match.group(2)), size - 1) if match.group(2) else size - 1
        else:
            start, end = max(0, size - int(match.group(2))), size - 1
        if start >= size or start > end:
            handle.close()
            response = HttpResponse(status=416)
            response["Content-Range"] = f"bytes */{size}"
            return response
        handle.seek(start)
        response = StreamingHttpResponse(_chunks(handle, end - start + 1), status=206, content_type=content_type)
        response["Content-Range"] = f"bytes {start}-{end}/{size}"
        response["Content-Length"] = str(end - start + 1)
    else:
        response = FileResponse(handle, content_type=content_type)
        response["Content-Length"] = str(size)
    response["Accept-Ranges"] = "bytes"
    response["Content-Disposition"] = "inline"
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, max-age=3600"
    # The course player shows PDFs in an <iframe> on the web app's own origin, so allow exactly those origins to frame
    # these files (instead of the site-wide X-Frame-Options: DENY).
    response.xframe_options_exempt = True
    response["Content-Security-Policy"] = f"frame-ancestors {_frame_ancestors()}"
    return response


def _frame_ancestors() -> str:
    from django.conf import settings
    if settings.DEBUG:
        return "*"
    origins = [o for o in getattr(settings, "CORS_ALLOWED_ORIGINS", []) if o.startswith(("http://", "https://"))]
    return " ".join(["'self'", *origins])


def course_media_view(request, token: str):
    from identity.models import User
    from .models import Lesson

    try:
        data = signing.loads(token, salt=SALT, max_age=MAX_AGE_SECONDS)
    except signing.BadSignature:  # also covers an expired link
        raise Http404("This link has expired. Reopen the lesson to get a new one.")
    lesson = Lesson.objects.select_related("module").filter(pk=data.get("l")).first()
    user = User.objects.filter(pk=data.get("u"), is_active=True).first()
    kind = data.get("k")
    if lesson is None or user is None or kind not in FIELDS or not may_access(user, lesson):
        raise Http404
    field_file = getattr(lesson, FIELDS[kind])
    if not field_file:
        raise Http404
    return file_response(request, field_file)
