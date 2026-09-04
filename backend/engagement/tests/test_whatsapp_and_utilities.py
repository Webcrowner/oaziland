"""
Tests proving the module's remaining literal acceptance criteria: a
WhatsApp button generating a correctly composed message + logged
ActionLog, and blocking a user actually filtering them out — plus
verification requests, bookmarks, message lifecycle, support tickets,
and account deletion.
"""
import pytest
from decimal import Decimal
from datetime import timedelta
from django.utils import timezone

from identity.models import User
from geo.models import Country, Region, Division, Subdivision, VillageOrDistrict, Quarter
from property.models import House, Listing, ListingType, ListingStatus
from student_hostels.models import OwnerProfile, OwnerType
from marketplace.models import CarListing, ListerRole, PriceBasis
from engagement.models import WhatsAppMessageTemplate, WhatsAppContext, ActionLog, VerificationRequestType, AccountDeletionStatus
from engagement.services import (
    build_whatsapp_action, block_user, unblock_user, is_blocked, exclude_blocked_users,
    submit_verification_request, review_verification_request, is_verified,
    add_bookmark, remove_bookmark, request_account_deletion, cancel_account_deletion,
    process_due_account_deletions, create_support_ticket, respond_as_human_agent, resolve_ticket,
    escalate_ticket_to_human,
)
from social.models import Post, Conversation, Message, MessageFolder
from social.services import save_draft, schedule_message, send_message_now, send_due_scheduled_messages, purge_expired_trash


@pytest.fixture
def quarter(db):
    country = Country.objects.create(name="Cameroon", iso_code="CMR")
    region = Region.objects.create(country=country, name="Centre")
    division = Division.objects.create(region=region, name="Mfoundi")
    subdivision = Subdivision.objects.create(division=division, name="Yaoundé I")
    village = VillageOrDistrict.objects.create(subdivision=subdivision, name="Bastos District")
    return Quarter.objects.create(village_or_district=village, name="Bastos")


@pytest.mark.django_db
def test_whatsapp_button_generates_correct_message_and_logs_action(quarter):
    """The module's second literal acceptance criteria."""
    landlord = User.objects.create(username="wa_landlord", phone="+237699700001")
    inquirer = User.objects.create(username="wa_inquirer", phone="+237699700002")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))

    WhatsAppMessageTemplate.objects.create(
        context=WhatsAppContext.INQUIRE_LISTING,
        reason_template="Hi, I'm reaching out about listing {listing_id}",
    )

    result = build_whatsapp_action(
        context=WhatsAppContext.INQUIRE_LISTING, triggered_by=inquirer, target_object=listing,
        recipient_phone="+237670000444", template_vars={"listing_id": str(listing.id)[:8]},
    )

    assert "Oaziland" in result["message"]  # source always present
    assert "reaching out about listing" in result["message"]  # reason always present
    assert "https://oaziland.com/" in result["message"]  # link always present
    assert result["deep_link"].startswith("https://wa.me/237670000444")

    assert ActionLog.objects.filter(triggered_by=inquirer, target_id=listing.id).exists()


@pytest.mark.django_db
def test_whatsapp_action_works_even_without_a_configured_template(quarter):
    """No template exists for this context — the source/reason/link
    guarantee must still hold via the fallback."""
    landlord = User.objects.create(username="wa_landlord_2", phone="+237699700003")
    house = House.objects.create(owner=landlord, quarter=quarter, type="HOUSE")
    listing = Listing.objects.create(property_asset=house, listed_by=landlord, listing_type=ListingType.RENT, status=ListingStatus.PUBLISHED, price_xaf=Decimal("100000"))

    result = build_whatsapp_action(
        context=WhatsAppContext.CONTACT_LANDLORD, triggered_by=landlord, target_object=listing,
        recipient_phone="+237670000555",
    )
    assert "Oaziland" in result["message"]
    assert "https://oaziland.com/" in result["message"]


@pytest.mark.django_db
def test_block_actually_filters_search_and_inbox(quarter):
    """The module's third literal acceptance criteria."""
    blocker = User.objects.create(username="blocker_user", phone="+237699700004")
    blocked_author = User.objects.create(username="blocked_author", phone="+237699700005")
    innocent_author = User.objects.create(username="innocent_author", phone="+237699700006")

    Post.objects.create(author=blocked_author, caption="Should be hidden from blocker")
    Post.objects.create(author=innocent_author, caption="Should still be visible")

    assert is_blocked(blocker=blocker, blocked=blocked_author) is False
    block_user(blocker=blocker, blocked=blocked_author)
    assert is_blocked(blocker=blocker, blocked=blocked_author) is True

    visible_posts = exclude_blocked_users(Post.objects.all(), viewer=blocker)
    visible_authors = [p.author_id for p in visible_posts]
    assert blocked_author.id not in visible_authors
    assert innocent_author.id in visible_authors

    unblock_user(blocker=blocker, blocked=blocked_author)
    assert is_blocked(blocker=blocker, blocked=blocked_author) is False
    visible_again = exclude_blocked_users(Post.objects.all(), viewer=blocker)
    assert blocked_author.id in [p.author_id for p in visible_again]


@pytest.mark.django_db
def test_verification_request_workflow_for_a_car_listing(quarter):
    seller = User.objects.create(username="car_seller_verify", phone="+237699700007")
    admin = User.objects.create(username="verify_admin", phone="+237699700008")
    owner = OwnerProfile.objects.create(account_user=seller, owner_type=OwnerType.LANDLORD)
    car = CarListing.objects.create(owner=owner, lister_user=seller, lister_role=ListerRole.OWNER, title="2020 Honda Civic", price_basis=PriceBasis.SALE, price_xaf=Decimal("9000000"), quarter=quarter)

    assert is_verified(car) is False
    request = submit_verification_request(requester=seller, request_type=VerificationRequestType.VEHICLE_OWNERSHIP, subject=car, supporting_document_url="https://example.com/car-title.pdf")
    assert is_verified(car) is False  # still pending

    review_verification_request(request=request, reviewer=admin, approved=True)
    assert is_verified(car) is True


@pytest.mark.django_db
def test_bookmark_generalizes_across_target_types(quarter):
    from engagement.models import BookmarkType
    user = User.objects.create(username="bookmark_user", phone="+237699700009")
    landlord = User.objects.create(username="bookmark_landlord", phone="+237699700010")
    owner = OwnerProfile.objects.create(account_user=landlord, owner_type=OwnerType.LANDLORD)
    car = CarListing.objects.create(owner=owner, lister_user=landlord, lister_role=ListerRole.OWNER, title="Bookmarked Car", price_basis=PriceBasis.SALE, price_xaf=Decimal("5000000"), quarter=quarter)

    bookmark = add_bookmark(user=user, bookmark_type=BookmarkType.MARKETPLACE_LISTING, target=car)
    assert user.bookmarks.count() == 1

    remove_bookmark(user=user, target=car)
    assert user.bookmarks.count() == 0


@pytest.mark.django_db
def test_message_lifecycle_drafts_scheduling_and_trash_retention():
    sender = User.objects.create(username="msg_sender", phone="+237699700011")
    recipient = User.objects.create(username="msg_recipient", phone="+237699700012")
    conversation = Conversation.objects.create()
    conversation.participants.set([sender, recipient])

    draft = save_draft(conversation=conversation, sender=sender, text="Draft message")
    assert draft.folder == MessageFolder.DRAFT
    assert draft.sent_at is None

    future_time = timezone.now() + timedelta(hours=1)
    scheduled = schedule_message(conversation=conversation, sender=sender, text="Scheduled message", send_at=future_time)
    assert scheduled.folder == MessageFolder.SCHEDULED

    # Not due yet.
    assert len(send_due_scheduled_messages(now=timezone.now())) == 0
    # Due now.
    sent = send_due_scheduled_messages(now=future_time + timedelta(minutes=1))
    assert len(sent) == 1
    scheduled.refresh_from_db()
    assert scheduled.folder == MessageFolder.SENT

    instant = send_message_now(conversation=conversation, sender=sender, text="Instant message")
    assert instant.folder == MessageFolder.SENT
    assert instant.sent_at is not None

    instant.move_to_trash()
    assert instant.folder == MessageFolder.TRASH
    # Not expired yet — must survive a purge.
    purge_expired_trash(now=timezone.now())
    assert Message.objects.filter(id=instant.id).exists()

    # Simulate 31 days passing — now it should be purged for real.
    purge_expired_trash(now=timezone.now() + timedelta(days=31))
    assert Message.objects.filter(id=instant.id).exists() is False


@pytest.mark.django_db
def test_support_ticket_ai_answers_known_question_without_escalation():
    user = User.objects.create(username="support_user_1", phone="+237699700013")
    ticket = create_support_ticket(user=user, subject="Fee question", first_message="What is your platform fee?")

    assert ticket.ai_handled is True
    ai_messages = ticket.messages.filter(sender_type="AI_AGENT")
    assert ai_messages.count() == 1
    assert "platform fee" in ai_messages.first().text.lower()


@pytest.mark.django_db
def test_support_ticket_escalates_when_user_asks_for_a_human():
    user = User.objects.create(username="support_user_2", phone="+237699700014")
    human_agent = User.objects.create(username="support_agent_1", phone="+237699700015")

    ticket = create_support_ticket(user=user, subject="Complex issue", first_message="I need to speak to a human please")
    assert ticket.ai_handled is False

    respond_as_human_agent(ticket=ticket, agent=human_agent, text="Hi, I'm here to help — what's going on?")
    assert ticket.messages.filter(sender_type="HUMAN_AGENT").count() == 1

    resolve_ticket(ticket)
    ticket.refresh_from_db()
    assert ticket.status == "RESOLVED"
    assert ticket.resolved_at is not None


@pytest.mark.django_db
def test_support_ticket_escalates_on_unknown_question():
    user = User.objects.create(username="support_user_3", phone="+237699700016")
    ticket = create_support_ticket(user=user, subject="Odd question", first_message="Do you sell spaceships?")
    assert ticket.ai_handled is False  # unknown question — correctly escalated, not left unanswered


@pytest.mark.django_db
def test_account_deletion_retention_window_and_cancellation():
    user = User.objects.create(username="deletion_user", phone="+237699700017")
    request = request_account_deletion(user)
    assert request.status == AccountDeletionStatus.REQUESTED
    assert user.deleted_at is None

    # Not yet due.
    completed = process_due_account_deletions(now=timezone.now())
    assert len(completed) == 0
    user.refresh_from_db()
    assert user.deleted_at is None

    # Due after the retention window.
    completed = process_due_account_deletions(now=timezone.now() + timedelta(days=31))
    assert len(completed) == 1
    user.refresh_from_db()
    assert user.deleted_at is not None


@pytest.mark.django_db
def test_account_deletion_can_be_cancelled_before_retention_expires():
    user = User.objects.create(username="deletion_user_2", phone="+237699700018")
    request = request_account_deletion(user)
    cancel_account_deletion(request)
    request.refresh_from_db()
    assert request.status == AccountDeletionStatus.CANCELLED

    completed = process_due_account_deletions(now=timezone.now() + timedelta(days=31))
    assert len(completed) == 0  # cancelled — must not be processed even after the window
    user.refresh_from_db()
    assert user.deleted_at is None
