"""
Tests for the OpenRouter-backed AI support chatbot: grounding real
platform data into the prompt, the OpenRouter provider itself (network
call mocked — never hits the real API in tests), and the actual
support-ticket endpoints that back the chat widget end-to-end.
"""
from decimal import Decimal
from unittest.mock import patch, MagicMock

import pytest
from rest_framework.test import APIClient

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from engagement.services import build_platform_context, create_support_ticket, continue_support_ticket
from engagement.support_agent import OpenRouterSupportAgentProvider, SupportAgentReply


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_build_platform_context_surfaces_real_matching_listings(quarter):
    landlord = User.objects.create(username="chatbot_landlord", phone="+237699800001")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    Listing.objects.create(
        property_asset=house, listed_by=landlord, listing_type=ListingType.RENT,
        status=ListingStatus.PUBLISHED, price_xaf=Decimal("75000"),
    )

    context = build_platform_context(user=None, message="What's the best apartment for rent in Bastos?")

    assert "Bastos" in context
    assert "75000" in context.replace(".00", "")


@pytest.mark.django_db
def test_build_platform_context_ignores_unrelated_questions(quarter):
    landlord = User.objects.create(username="chatbot_landlord_2", phone="+237699800002")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    Listing.objects.create(
        property_asset=house, listed_by=landlord, listing_type=ListingType.RENT,
        status=ListingStatus.PUBLISHED, price_xaf=Decimal("75000"),
    )

    context = build_platform_context(user=None, message="What time is it?")

    assert context == ""


def test_openrouter_provider_parses_a_successful_reply():
    provider = OpenRouterSupportAgentProvider()
    provider.api_key = "test-key"

    fake_response = MagicMock()
    fake_response.raise_for_status = MagicMock()
    fake_response.json.return_value = {"choices": [{"message": {"content": "Here are the best options for you."}}]}

    with patch("engagement.support_agent.requests.post", return_value=fake_response) as mock_post:
        reply = provider.generate_response(
            ticket_subject="Best option", conversation_history=[], latest_message="What's the cheapest rental?",
            platform_context="- House in Bastos, Rent, 75000 XAF (listing id abc)",
        )

    assert isinstance(reply, SupportAgentReply)
    assert reply.response_text == "Here are the best options for you."
    assert reply.should_escalate_to_human is False
    sent_payload = mock_post.call_args.kwargs["json"]
    assert "75000" in sent_payload["messages"][0]["content"]


def test_openrouter_provider_escalates_on_request_failure():
    provider = OpenRouterSupportAgentProvider()
    provider.api_key = "test-key"

    with patch("engagement.support_agent.requests.post", side_effect=ConnectionError("network down")):
        reply = provider.generate_response(ticket_subject="x", conversation_history=[], latest_message="hello")

    assert reply.should_escalate_to_human is True


def test_openrouter_provider_requires_an_api_key():
    provider = OpenRouterSupportAgentProvider()
    provider.api_key = ""

    with pytest.raises(NotImplementedError):
        provider.generate_response(ticket_subject="x", conversation_history=[], latest_message="hello")


@pytest.mark.django_db
def test_starting_and_continuing_a_chat_via_the_api():
    user = User.objects.create(username="chatbot_chat_user", phone="+237699800003")
    client = APIClient()
    client.force_authenticate(user=user)

    create_response = client.post("/api/support-tickets/", {"message": "What is your platform fee?"}, format="json")
    assert create_response.status_code == 201
    ticket_id = create_response.data["id"]
    assert len(create_response.data["messages"]) == 2  # the user's message + the AI's reply
    assert create_response.data["ai_handled"] is True

    list_response = client.get("/api/support-tickets/")
    assert list_response.status_code == 200
    assert list_response.data["count"] == 1

    reply_response = client.post(f"/api/support-tickets/{ticket_id}/", {"message": "Thanks, one more question"}, format="json")
    assert reply_response.status_code == 200
    assert len(reply_response.data["messages"]) == 4


@pytest.mark.django_db
def test_asking_for_a_human_stops_further_auto_replies():
    user = User.objects.create(username="chatbot_escalate_user", phone="+237699800004")
    ticket = create_support_ticket(user=user, subject="Need help", first_message="I need to speak to a human please")
    ticket.refresh_from_db()
    assert ticket.ai_handled is False

    continue_support_ticket(ticket=ticket, user=user, message="Are you still there?")
    ticket.refresh_from_db()

    # only the 2 original messages (user + AI escalation reply) plus this
    # new user message — no third AI reply, since a human now owns it.
    assert ticket.messages.count() == 3
    assert ticket.messages.last().sender_type == "USER"


@pytest.mark.django_db
def test_a_user_cannot_read_another_users_support_ticket():
    owner = User.objects.create(username="chatbot_ticket_owner", phone="+237699800005")
    outsider = User.objects.create(username="chatbot_ticket_outsider", phone="+237699800006")
    ticket = create_support_ticket(user=owner, subject="Private", first_message="What is your platform fee?")

    client = APIClient()
    client.force_authenticate(user=outsider)
    response = client.get(f"/api/support-tickets/{ticket.id}/")

    assert response.status_code == 404


@pytest.mark.django_db
def test_anonymous_visitor_can_chat_without_signing_up(quarter):
    landlord = User.objects.create(username="chatbot_anon_landlord", phone="+237699800007")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    Listing.objects.create(
        property_asset=house, listed_by=landlord, listing_type=ListingType.RENT,
        status=ListingStatus.PUBLISHED, price_xaf=Decimal("60000"),
    )

    client = APIClient()  # deliberately not authenticated
    response = client.post("/api/chatbot/ask/", {"message": "What's the best apartment for rent?"}, format="json")

    assert response.status_code == 200
    assert "response_text" in response.data
    assert "should_escalate_to_human" in response.data
    from engagement.models import SupportTicket
    assert SupportTicket.objects.count() == 0  # nothing persisted for an anonymous visitor


@pytest.mark.django_db
def test_anonymous_chat_requires_a_message():
    client = APIClient()
    response = client.post("/api/chatbot/ask/", {"message": ""}, format="json")
    assert response.status_code == 400
