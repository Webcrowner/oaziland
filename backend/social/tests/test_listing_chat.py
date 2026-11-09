"""Messages about a marketplace listing: the buyer asks the lister about a car (or any item) and the chat shows
the listing as a card on both sides."""
import pytest

from identity.models import User
from social.models import Message
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401
from marketplace.tests.test_car_rentals import _post_car


@pytest.fixture
def chat(quarter):
    owner = _verify(User.objects.create(username="lc_owner", phone="+237699810001"))
    buyer = User.objects.create(username="lc_buyer", phone="+237699810002")
    car_id = _post_car(_auth_client(owner), quarter).data["id"]
    conversation = _auth_client(buyer).post("/api/conversations/", {"participant_id": str(owner.id)}).data["id"]
    return owner, buyer, car_id, conversation


@pytest.mark.django_db
def test_a_buyer_asks_about_a_car_and_both_see_the_listing_card(chat):
    owner, buyer, car_id, conversation = chat
    sent = _auth_client(buyer).post(f"/api/conversations/{conversation}/send/", {"text": "Is it still available?", "listing_id": car_id}, format="json")
    assert sent.status_code == 201, sent.data
    assert sent.data["listing"]["id"] == car_id and sent.data["listing"]["category"] == "cars"
    thread = _auth_client(owner).get(f"/api/conversations/{conversation}/messages/").data
    assert thread[0]["listing"]["title"] == "Toyota RAV4 2019" and thread[0]["text"] == "Is it still available?"
    from notifications.models import Notification
    assert Notification.objects.filter(recipient=owner, message__startswith='About "Toyota RAV4 2019"').exists()


@pytest.mark.django_db
def test_only_a_participant_s_own_listing_can_be_attached(chat, quarter):
    owner, buyer, car_id, conversation = chat
    stranger = _verify(User.objects.create(username="lc_stranger", phone="+237699810003"))
    other_car = _post_car(_auth_client(stranger), quarter).data["id"]
    client = _auth_client(buyer)
    assert client.post(f"/api/conversations/{conversation}/send/", {"text": "Hi", "listing_id": other_car}, format="json").status_code == 400
    assert client.post(f"/api/conversations/{conversation}/send/", {"text": "Hi", "listing_id": "not-a-uuid"}, format="json").status_code == 400
    # The owner can point the buyer to their own listing too.
    assert _auth_client(owner).post(f"/api/conversations/{conversation}/send/", {"text": "This one", "listing_id": car_id}, format="json").status_code == 201


@pytest.mark.django_db
def test_a_removed_listing_card_disappears_but_the_message_stays(chat):
    owner, buyer, car_id, conversation = chat
    _auth_client(buyer).post(f"/api/conversations/{conversation}/send/", {"text": "Still there?", "listing_id": car_id}, format="json")
    from marketplace.services import take_down_listing
    take_down_listing(car_id)
    thread = _auth_client(buyer).get(f"/api/conversations/{conversation}/messages/").data
    assert thread[0]["text"] == "Still there?" and thread[0]["listing"] is None
    assert Message.objects.get().marketplace_listing_id is not None
