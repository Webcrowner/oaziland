"""
careers.course_creator_views — admins decide who may create their own courses (/api/admin/course-creators/).

A grant lets a trainer create courses as their provider (paid for them). With can_publish they put courses live
themselves; without it, they submit drafts and an admin reviews and publishes them (listed here as awaiting review).
Revoking stops new courses and publishing; the trainer keeps managing courses they already made, for their learners.
"""
from rest_framework import permissions, status, viewsets
from rest_framework.response import Response

from oaziland.permissions import IsAdminRole
from .course_services import find_user, is_platform_admin
from .models import CourseCreatorAccess, TrainingProgram
from .services import _in_language, _send


def _person(user):
    return {
        "id": str(user.pk), "name": user.full_name or user.username, "username": user.username,
        "phone": getattr(user, "phone", "") or "", "email": user.email or "",
    }


def _grant_payload(access):
    courses = TrainingProgram.objects.filter(provider=access.user)
    return {
        "id": access.pk,
        "user": _person(access.user),
        "can_publish": access.can_publish,
        "granted_by": (access.granted_by.full_name or access.granted_by.username) if access.granted_by else "",
        "granted_at": access.granted_at,
        "course_count": courses.count(),
        "published_count": courses.filter(is_published=True).count(),
    }


def _flag(value) -> bool:
    return value in (True, 1, "1", "true", "True", "on")


def _notify(user, english_title, french_title, english, french):
    _send(
        recipient=user, notification_type="COURSE_CREATOR_ACCESS",
        title=_in_language(user, english_title, french_title), message=_in_language(user, english, french),
    )


class CourseCreatorAccessViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]

    def list(self, request):
        grants = CourseCreatorAccess.objects.select_related("user", "granted_by").order_by("-granted_at")
        awaiting = (
            TrainingProgram.objects.filter(review_requested_at__isnull=False, is_published=False)
            .select_related("provider").order_by("review_requested_at")
        )
        return Response({
            "results": [_grant_payload(access) for access in grants],
            "awaiting_review": [
                {"id": str(p.id), "title": p.title, "provider": _person(p.provider), "requested_at": p.review_requested_at}
                for p in awaiting
            ],
        })

    def create(self, request):
        """{identifier: username, phone or email; can_publish: bool} — grants (or updates) access."""
        user = find_user(str(request.data.get("identifier", "")))
        if user is None:
            return Response({"detail": "No user found with that username, phone number or email."}, status=status.HTTP_400_BAD_REQUEST)
        if is_platform_admin(user):
            return Response({"detail": "Administrators can already create courses."}, status=status.HTTP_400_BAD_REQUEST)
        can_publish = _flag(request.data.get("can_publish", True))
        access, created = CourseCreatorAccess.objects.update_or_create(
            user=user, defaults={"can_publish": can_publish, "granted_by": request.user},
        )
        if created:
            _notify(
                user, "You can now create courses", "Vous pouvez maintenant créer des formations",
                "An administrator gave you access to create your own courses. Open Training & Courses → Manage courses to start."
                + ("" if can_publish else " An administrator will review each course before it goes live."),
                "Un administrateur vous a donné accès à la création de vos propres formations. Ouvrez Formation & Cours → Gérer les cours pour commencer."
                + ("" if can_publish else " Un administrateur vérifiera chaque formation avant sa mise en ligne."),
            )
        return Response(_grant_payload(access), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def partial_update(self, request, pk=None):
        access = CourseCreatorAccess.objects.select_related("user", "granted_by").filter(pk=pk).first()
        if access is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if "can_publish" in request.data:
            access.can_publish = _flag(request.data["can_publish"])
            access.save(update_fields=["can_publish"])
        return Response(_grant_payload(access))

    def destroy(self, request, pk=None):
        access = CourseCreatorAccess.objects.select_related("user").filter(pk=pk).first()
        if access is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        user = access.user
        access.delete()
        _notify(
            user, "Course creation access removed", "Accès à la création de formations retiré",
            "An administrator removed your access to create new courses. You can still manage the courses you already made.",
            "Un administrateur a retiré votre accès à la création de nouvelles formations. Vous pouvez toujours gérer celles que vous avez déjà créées.",
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
