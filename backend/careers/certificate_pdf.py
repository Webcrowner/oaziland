"""
careers.certificate_pdf — an issued course certificate as a downloadable, printable PDF (and a PNG for the web page).

The design is the one frozen onto the certificate when it was issued (careers.certificate_templates.freeze_design);
this module only supplies the per-certificate values for its {placeholders}.
"""
from django.conf import settings
from PIL import Image

from . import certificate_templates

MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]


def verification_url(certificate_code: str, locale: str = "en") -> str:
    return f"{settings.WEB_BASE_URL}/{locale}/certificates/{certificate_code}"


def _date(moment, locale: str) -> str:
    if locale == "fr":
        return f"{moment.day} {MONTHS_FR[moment.month - 1]} {moment.year}"
    return moment.strftime("%B %d, %Y").replace(" 0", " ")


def _hours(hours, locale: str) -> str:
    if hours is None:
        return ""
    number = f"{hours.normalize():f}"
    if locale == "fr":
        return f"{number.replace('.', ',')} {'heure' if hours < 2 else 'heures'}"
    return f"{number} {'hour' if hours == 1 else 'hours'}"


def certificate_values(enrollment, locale: str = "en") -> dict:
    from django.utils import timezone

    from .course_services import lessons_of

    program, student = enrollment.program, enrollment.student
    lesson_count = lessons_of(program).count()
    if not lesson_count:
        lessons = ""
    elif locale == "fr":
        lessons = "1 leçon" if lesson_count == 1 else f"{lesson_count} leçons"
    else:
        lessons = "1 lesson" if lesson_count == 1 else f"{lesson_count} lessons"
    grade = enrollment.certificate_grade_percent
    completed = enrollment.completed_at or enrollment.certificate_issued_at
    expires = enrollment.certificate_expires_at
    return {
        "learner_name": student.full_name or student.username,
        "course_title": program.title,
        "trainer_name": program.provider.full_name or program.provider.username,
        "issue_date": _date(timezone.localtime(enrollment.certificate_issued_at), locale),
        "certificate_code": enrollment.certificate_code,
        "verify_url": verification_url(enrollment.certificate_code, locale),
        "lessons": lessons,
        "course_hours": _hours(enrollment.certificate_hours, locale),
        "final_grade": "" if grade is None else (f"{grade} %" if locale == "fr" else f"{grade}%"),
        "completion_date": _date(timezone.localtime(completed), locale),
        "expiry_date": _date(timezone.localtime(expires), locale) if expires else "",
    }


def certificate_design(enrollment):
    """The design frozen when the certificate was issued; certificates issued before designs were frozen fall back
    to the course's current template (the 0014 migration freezes those too)."""
    if enrollment.certificate_design_id:
        return enrollment.certificate_design
    return certificate_templates.template_for_program(enrollment.program)


def render_certificate_image(enrollment, locale: str = "en") -> Image.Image:
    locale = "fr" if locale == "fr" else "en"
    return certificate_templates.render(certificate_design(enrollment), certificate_values(enrollment, locale), locale)


def render_certificate_pdf(enrollment, locale: str = "en") -> bytes:
    student = enrollment.student
    title = f"{student.full_name or student.username} - {enrollment.program.title}"
    return certificate_templates.to_pdf(render_certificate_image(enrollment, locale), title)