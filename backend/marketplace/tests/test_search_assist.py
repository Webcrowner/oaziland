"""Marketplace search assistance: spelling hints, synonyms, trending searches and search by photo."""
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from discovery.models import MarketplaceSearchTerm, MarketplaceSearchTermDay
from identity.models import User
from marketplace import search_assist
from marketplace.tests.test_listing_search import _post
from marketplace.tests.test_marketplace_api import _verify, _auth_client, quarter  # noqa: F401

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
VISION_RESPONSE = {"responses": [{
    "labelAnnotations": [
        {"description": "Furniture", "score": 0.97}, {"description": "Product", "score": 0.99},
        {"description": "Couch", "score": 0.95}, {"description": "Comfort", "score": 0.4},
    ],
    "localizedObjectAnnotations": [{"name": "Couch", "score": 0.9}, {"name": "Pillow", "score": 0.7}],
}]}


@pytest.fixture(autouse=True)
def clean_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def lister(quarter):
    client = _auth_client(_verify(User.objects.create(username="sa_lister", phone="+237699500001")))
    _post(client, quarter, "Samsung Galaxy A54", "150000", basis="SALE")
    _post(client, quarter, "Used sofa", "80000", basis="SALE")
    _post(client, quarter, "Cheap shed", "100000")
    return client


def _upload(content=JPEG, name="photo.jpg", content_type="image/jpeg"):
    return APIClient().post(
        "/api/marketplace-search/image/", {"image": SimpleUploadedFile(name, content, content_type=content_type)}, format="multipart",
    )


@pytest.mark.django_db
def test_did_you_mean_fixes_typos_and_leaves_correct_words_alone(lister):
    assert search_assist.did_you_mean("samsug galaxi") == "samsung galaxy"
    assert search_assist.did_you_mean("samsung galaxy") is None
    assert search_assist.did_you_mean("samsu") is None  # half typed
    data = APIClient().get("/api/marketplace-search/assist/", {"q": "samsug galaxi"}).data
    assert data == {"query": "samsug galaxi", "did_you_mean": "samsung galaxy", "synonyms": []}


@pytest.mark.django_db
def test_assist_lists_the_synonyms_also_searched():
    data = APIClient().get("/api/marketplace-search/assist/", {"q": "couch"}).data
    assert data["did_you_mean"] is None
    assert {"sofa", "canapé", "settee"} <= set(data["synonyms"]) and "couch" not in data["synonyms"]


def test_multi_word_synonym_phrases_are_kept_together():
    units = search_assist.expand_terms("Ordinateur portable HP")
    assert units[0][0] == "Ordinateur portable" and "laptop" in units[0]
    assert units[1] == ["HP"]


@pytest.mark.django_db
def test_search_finds_listings_by_synonym_in_english_and_french(lister):
    for q in ("couch", "canapé", "used couch"):
        titles = [r["title"] for r in APIClient().get("/api/warehouses/", {"q": q}).data["results"]]
        assert titles == ["Used sofa"], q
    assert APIClient().get("/api/warehouses/", {"q": "couch shed"}).data["results"] == []


@pytest.mark.django_db
def test_trending_ranks_by_count_and_hides_terms_with_no_results():
    for client in ("a", "b", "c"):
        search_assist.record_search("Solar Panel", 5, client=client)
    for client in ("a", "b"):
        search_assist.record_search("frigo", 2, client=client)
    for client in ("a", "b", "c", "d"):
        search_assist.record_search("unicorn", 0, client=client)
    results = APIClient().get("/api/marketplace-search/trending/?days=7").data["results"]
    assert results == [{"term": "solar panel", "count": 3}, {"term": "frigo", "count": 2}]


@pytest.mark.django_db
def test_trending_only_counts_the_window_and_old_days_are_pruned():
    search_assist.record_search("laptop", 3, client="a")
    old = timezone.localdate() - timedelta(days=40)
    MarketplaceSearchTermDay.objects.create(term="laptop", day=old, count=50)
    MarketplaceSearchTermDay.objects.create(term="stale", day=timezone.localdate() - timedelta(days=10), count=9)
    assert search_assist.trending_searches(days=7) == [{"term": "laptop", "count": 1}]
    assert search_assist.prune_old_days() == 1
    assert not MarketplaceSearchTermDay.objects.filter(day=old).exists()


@pytest.mark.django_db
def test_record_search_ignores_short_url_and_numeric_queries_and_stores_no_user():
    for q in ("ab", "x" * 61, "https://evil.example/a", "www.example.com", "677123456", "me@mail.com"):
        assert search_assist.record_search(q, 1, client="a") is False
    assert not MarketplaceSearchTerm.objects.exists()
    assert not {f.name for f in MarketplaceSearchTerm._meta.fields} & {"user", "ip_address"}


@pytest.mark.django_db
def test_a_repeated_search_from_the_same_client_counts_once_per_minute():
    assert search_assist.record_search("Laptop ", 4, client="phone-1") is True
    assert search_assist.record_search("laptop", 4, client="phone-1") is False
    assert search_assist.record_search("laptop", 4, client="phone-2") is True
    row = MarketplaceSearchTerm.objects.get(term="laptop")
    assert row.count == 2 and row.results_last == 4
    assert MarketplaceSearchTermDay.objects.get(term="laptop").count == 2


@pytest.mark.django_db
def test_browsing_logs_first_page_searches_and_logging_failures_do_not_break_it(lister, monkeypatch):
    assert APIClient().get("/api/warehouses/", {"q": "couch"}).status_code == 200
    assert MarketplaceSearchTerm.objects.get(term="couch").results_last == 1
    assert APIClient().get("/api/marketplace-feed/", {"q": "shed", "page": 1}).status_code == 200
    assert MarketplaceSearchTerm.objects.get(term="shed").results_last == 1

    APIClient().get("/api/warehouses/", {"q": "depot", "page": 2})
    assert not MarketplaceSearchTerm.objects.filter(term="depot").exists()

    def boom(*args, **kwargs):
        raise RuntimeError("db down")
    monkeypatch.setattr(search_assist, "record_search", boom)
    assert APIClient().get("/api/warehouses/", {"q": "sofa"}).status_code == 200


@pytest.mark.django_db
def test_image_search_is_unavailable_without_a_vision_key(settings):
    settings.GOOGLE_CLOUD_VISION_API_KEY = ""
    response = _upload()
    assert response.status_code == 503
    assert response.data == {"detail": "Visual search isn't available right now."}


@pytest.mark.django_db
def test_image_search_rejects_bad_files(settings):
    settings.GOOGLE_CLOUD_VISION_API_KEY = "test-key"
    assert _upload(b"GIF89a....", "a.gif", "image/gif").status_code == 400
    assert _upload(b"not really an image", "a.jpg", "image/jpeg").status_code == 400
    assert _upload(JPEG + b"\x00" * (5 * 1024 * 1024)).status_code == 400
    assert APIClient().post("/api/marketplace-search/image/", {}, format="multipart").status_code == 400


@pytest.mark.django_db
def test_image_search_returns_keywords_from_google_vision(settings, monkeypatch):
    settings.GOOGLE_CLOUD_VISION_API_KEY = "test-key"
    sent = {}

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return VISION_RESPONSE

    def fake_post(url, json=None, headers=None, timeout=None):
        sent.update(url=url, body=json, headers=headers, timeout=timeout)
        return FakeResponse()

    monkeypatch.setattr("marketplace.search_assist.requests.post", fake_post)
    response = _upload()
    assert response.status_code == 200
    assert response.data == {"keywords": ["couch", "furniture", "pillow"], "q": "couch furniture"}
    assert sent["timeout"] == 10 and sent["headers"] == {"X-Goog-Api-Key": "test-key"}
    assert [f["type"] for f in sent["body"]["requests"][0]["features"]] == ["LABEL_DETECTION", "OBJECT_LOCALIZATION"]
