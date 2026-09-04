"""
Tests for connecting other social accounts (Facebook, TikTok, etc.) to
a user's Oaziland profile — both at the service layer and through the
real API, confirming a user only ever manages their OWN links.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from social.models import SocialPlatform, SocialAccountLink
from social.services import link_social_account, unlink_social_account, list_social_accounts


def _auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_linking_and_listing_social_accounts():
    user = User.objects.create(username="social_link_user", phone="+237699999001")
    link_social_account(user=user, platform=SocialPlatform.TIKTOK, handle_or_url="https://tiktok.com/@example")
    link_social_account(user=user, platform=SocialPlatform.FACEBOOK, handle_or_url="https://facebook.com/example")

    links = list_social_accounts(user)
    assert links.count() == 2
    platforms = set(links.values_list("platform", flat=True))
    assert platforms == {SocialPlatform.TIKTOK, SocialPlatform.FACEBOOK}


@pytest.mark.django_db
def test_relinking_the_same_platform_replaces_not_duplicates():
    """A user updating their TikTok handle shouldn't end up with two
    TikTok links."""
    user = User.objects.create(username="social_relink_user", phone="+237699999002")
    link_social_account(user=user, platform=SocialPlatform.TIKTOK, handle_or_url="https://tiktok.com/@old_handle")
    link_social_account(user=user, platform=SocialPlatform.TIKTOK, handle_or_url="https://tiktok.com/@new_handle")

    links = SocialAccountLink.objects.filter(user=user, platform=SocialPlatform.TIKTOK)
    assert links.count() == 1
    assert links.first().handle_or_url == "https://tiktok.com/@new_handle"


@pytest.mark.django_db
def test_unlinking_a_social_account():
    user = User.objects.create(username="social_unlink_user", phone="+237699999003")
    link_social_account(user=user, platform=SocialPlatform.INSTAGRAM, handle_or_url="https://instagram.com/example")
    assert list_social_accounts(user).count() == 1

    unlink_social_account(user=user, platform=SocialPlatform.INSTAGRAM)
    assert list_social_accounts(user).count() == 0


@pytest.mark.django_db
def test_api_create_and_list_social_accounts():
    """Real HTTP requests through the actual API — an agent (or any
    user/actor) connecting their social accounts end-to-end."""
    agent = User.objects.create(username="social_api_agent", phone="+237699999004")
    client = _auth_client(agent)

    create_response = client.post("/api/social-accounts/", {
        "platform": SocialPlatform.TIKTOK, "handle_or_url": "https://tiktok.com/@agent_example",
    })
    assert create_response.status_code == 201

    list_response = client.get("/api/social-accounts/")
    assert list_response.status_code == 200
    assert list_response.data["count"] == 1
    assert list_response.data["results"][0]["platform"] == SocialPlatform.TIKTOK


@pytest.mark.django_db
def test_api_scopes_links_to_the_authenticated_user_only():
    """One user must never see or be able to touch another user's
    connected accounts through this API."""
    user_a = User.objects.create(username="social_api_user_a", phone="+237699999005")
    user_b = User.objects.create(username="social_api_user_b", phone="+237699999006")
    link_social_account(user=user_a, platform=SocialPlatform.FACEBOOK, handle_or_url="https://facebook.com/a")

    client_b = _auth_client(user_b)
    response = client_b.get("/api/social-accounts/")
    assert response.data["count"] == 0  # sees none of user_a's links


@pytest.mark.django_db
def test_api_requires_authentication():
    client = APIClient()  # no auth token
    response = client.get("/api/social-accounts/")
    assert response.status_code == 401
