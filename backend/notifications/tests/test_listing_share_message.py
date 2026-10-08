import pytest
from rest_framework.test import APIClient

from notifications.models import GreetingSettings


@pytest.mark.django_db
def test_listing_share_message_is_public_and_admin_editable():
    default = APIClient().get("/api/listing-share-message/")
    assert default.status_code == 200
    assert "{link}" in default.data["listing_share_message"]

    settings = GreetingSettings.get_settings()
    settings.listing_share_message = "Look at this: {link}"
    settings.save()

    updated = APIClient().get("/api/listing-share-message/")
    assert updated.data["listing_share_message"] == "Look at this: {link}"
