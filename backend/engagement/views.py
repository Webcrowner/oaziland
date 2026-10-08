"""engagement.views — the public Contact Us endpoint and the admin-managed FAQ."""
from rest_framework import generics, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from oaziland.permissions import IsAdminRole
from .models import Faq
from .serializers import AdminFaqSerializer, PublicFaqSerializer
from .services import submit_contact_message


class PublicFaqListView(generics.ListAPIView):
    """Published FAQs in the requested language (?lang=fr, default en); ?homepage=1 keeps only homepage ones."""
    permission_classes = [permissions.AllowAny]
    serializer_class = PublicFaqSerializer
    pagination_class = None

    def get_queryset(self):
        queryset = Faq.objects.filter(is_published=True)
        if self.request.query_params.get("homepage") == "1":
            queryset = queryset.filter(show_on_homepage=True)
        return queryset

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["lang"] = "fr" if self.request.query_params.get("lang") == "fr" else "en"
        return context


class AdminFaqViewSet(viewsets.ModelViewSet):
    """Full create/edit/delete for admins, including unpublished entries."""
    permission_classes = [IsAdminRole]
    serializer_class = AdminFaqSerializer
    queryset = Faq.objects.all()
    pagination_class = None

    @extend_schema(request=dict, responses={200: AdminFaqSerializer(many=True), 400: dict})
    @action(detail=False, methods=["post"])
    def reorder(self, request):
        """Body: {"ids": [<faq ids in the desired order>]}."""
        ids = request.data.get("ids")
        if not isinstance(ids, list) or set(ids) != set(Faq.objects.values_list("id", flat=True)):
            return Response({"detail": "ids must list every existing FAQ exactly once."}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            for position, faq_id in enumerate(ids):
                Faq.objects.filter(id=faq_id).update(display_order=position)
        return Response(AdminFaqSerializer(Faq.objects.all(), many=True).data)


class ContactMessageView(APIView):
    """Deliberately AllowAny — a prospective user should be able to
    reach out before ever creating an account, same reasoning as
    registration itself. Rate-limited to prevent spam submission."""
    permission_classes = [permissions.AllowAny]
    throttle_classes = [AnonRateThrottle]

    @extend_schema(request=dict, responses={201: dict, 400: dict})
    def post(self, request):
        name = request.data.get("name")
        email = request.data.get("email")
        message = request.data.get("message")
        if not all([name, email, message]):
            return Response({"detail": "name, email, and message are all required."}, status=status.HTTP_400_BAD_REQUEST)

        submit_contact_message(name=name, email=email, message=message)
        return Response({"detail": "Message sent."}, status=status.HTTP_201_CREATED)


class AnonymousChatbotView(APIView):
    """Stateless chat for anyone, signed in or not — deliberately never
    creates a SupportTicket (see answer_anonymous_chat_message()'s own
    docstring for why), so a visitor can ask Oazi about listings,
    prices, or best options before ever registering. Rate-limited by
    IP like ContactMessageView, for the same reason: no login gate to
    lean on against spam/abuse here."""
    permission_classes = [permissions.AllowAny]
    throttle_classes = [AnonRateThrottle]

    @extend_schema(request=dict, responses={200: dict, 400: dict})
    def post(self, request):
        from .services import answer_anonymous_chat_message

        message = (request.data.get("message") or "").strip()
        if not message:
            return Response({"detail": "message is required."}, status=status.HTTP_400_BAD_REQUEST)

        history = request.data.get("conversation_history") or []
        if not isinstance(history, list):
            history = []

        reply = answer_anonymous_chat_message(message=message, conversation_history=history)
        return Response({"response_text": reply.response_text, "should_escalate_to_human": reply.should_escalate_to_human})


class MyBadgesView(APIView):
    """The real gap this closes: evaluate_badges_for_user() (Prompt 15's
    'NEW — GamifiedBadge') was fully built and unit-tested, but was
    ONLY ever called from tests — never triggered by a real action, and
    nothing let a user see their own earned badges. Re-evaluates on
    every call so a badge earned since the last check appears
    immediately, on top of the real-action triggers wired elsewhere
    (KYC approval, review submitted, booking completed)."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        from .services import evaluate_badges_for_user
        from .models import BadgeCode
        evaluate_badges_for_user(request.user)
        badges = request.user.badges.order_by("-awarded_at")
        results = [
            {"badge_code": b.badge_code, "label": BadgeCode(b.badge_code).label, "awarded_at": b.awarded_at}
            for b in badges
        ]
        return Response({"count": len(results), "results": results})


class BlockUserView(APIView):
    """Block/unblock another user. One-directional by design (see
    BlockRelationship): the blocked person is never told, but can no
    longer message the blocker or appear in the blocker's feed."""
    permission_classes = [permissions.IsAuthenticated]

    def _target(self, user_id):
        from identity.models import User
        return get_object_or_404(User, pk=user_id)

    @extend_schema(responses={200: dict})
    def get(self, request, user_id):
        from .services import is_blocked
        target = self._target(user_id)
        return Response({"is_blocked": is_blocked(blocker=request.user, blocked=target)})

    @extend_schema(request=None, responses={200: dict, 400: dict})
    def post(self, request, user_id):
        from .services import block_user
        target = self._target(user_id)
        if target.id == request.user.id:
            return Response({"detail": "You can't block yourself."}, status=status.HTTP_400_BAD_REQUEST)
        block_user(blocker=request.user, blocked=target)
        return Response({"is_blocked": True})

    @extend_schema(responses={200: dict})
    def delete(self, request, user_id):
        from .services import unblock_user
        unblock_user(blocker=request.user, blocked=self._target(user_id))
        return Response({"is_blocked": False})


class MyBlockedUsersView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={200: dict})
    def get(self, request):
        relationships = request.user.blocks_initiated.select_related("blocked").order_by("-created_at")
        results = [
            {
                "id": str(r.blocked_id),
                "username": r.blocked.username,
                "full_name": r.blocked.full_name or r.blocked.username,
                "profile_image_url": r.blocked.profile_image_url,
                "blocked_at": r.created_at,
            }
            for r in relationships
        ]
        return Response({"count": len(results), "results": results})


def _serialize_ticket(ticket, include_messages: bool = False) -> dict:
    data = {
        "id": ticket.id, "subject": ticket.subject, "status": ticket.status,
        "ai_handled": ticket.ai_handled, "created_at": ticket.created_at,
    }
    if include_messages:
        data["messages"] = [
            {"id": m.id, "sender_type": m.sender_type, "text": m.text, "sent_at": m.sent_at}
            for m in ticket.messages.all()
        ]
    return data


class MySupportTicketsView(APIView):
    """The chatbot widget's entry point: lists the caller's own support
    conversations, or starts a brand new one — which gets a real AI
    reply immediately (engagement.services.create_support_ticket()),
    the same "built, tested, never reachable" gap as MyBadgesView above,
    just for the AI support agent instead of gamified badges."""
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(operation_id="list_my_support_tickets", responses={200: dict})
    def get(self, request):
        tickets = request.user.support_tickets.order_by("-created_at")
        return Response({"count": tickets.count(), "results": [_serialize_ticket(t) for t in tickets]})

    @extend_schema(operation_id="start_support_chat", request=dict, responses={201: dict, 400: dict})
    def post(self, request):
        from .services import create_support_ticket

        message = (request.data.get("message") or "").strip()
        if not message:
            return Response({"detail": "message is required."}, status=status.HTTP_400_BAD_REQUEST)
        subject = (request.data.get("subject") or "Chat with Oazi").strip()

        ticket = create_support_ticket(user=request.user, subject=subject, first_message=message)
        return Response(_serialize_ticket(ticket, include_messages=True), status=status.HTTP_201_CREATED)


class SupportTicketDetailView(APIView):
    """A single ticket's full conversation, and where a reply continues
    it (engagement.services.continue_support_ticket()) — scoped to the
    ticket's own owner (or an admin); 404s rather than 403s for anyone
    else, so another user's private support chat can't even be
    confirmed to exist by ID."""
    permission_classes = [permissions.IsAuthenticated]

    def _get_owned_ticket(self, request, ticket_id):
        from .models import SupportTicket
        ticket = get_object_or_404(SupportTicket, id=ticket_id)
        if ticket.submitted_by_id != request.user.id and not request.user.is_staff:
            return None
        return ticket

    @extend_schema(operation_id="get_support_ticket", responses={200: dict, 404: dict})
    def get(self, request, ticket_id):
        ticket = self._get_owned_ticket(request, ticket_id)
        if ticket is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(_serialize_ticket(ticket, include_messages=True))

    @extend_schema(operation_id="reply_to_support_ticket", request=dict, responses={200: dict, 400: dict, 404: dict})
    def post(self, request, ticket_id):
        from .services import continue_support_ticket

        ticket = self._get_owned_ticket(request, ticket_id)
        if ticket is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        message = (request.data.get("message") or "").strip()
        if not message:
            return Response({"detail": "message is required."}, status=status.HTTP_400_BAD_REQUEST)

        continue_support_ticket(ticket=ticket, user=request.user, message=message)
        return Response(_serialize_ticket(ticket, include_messages=True))
