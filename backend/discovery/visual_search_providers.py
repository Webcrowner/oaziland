"""
discovery.visual_search_providers — the VisualSearchProvider interface,
same pattern as PaymentGateway/ContentModerationProvider/
NotificationDispatcher: nothing else should call Google Cloud Vision
directly.
"""
from abc import ABC, abstractmethod


class VisualSearchProvider(ABC):
    @abstractmethod
    def find_similar_listings(self, image_url: str, candidate_listing_ids: list) -> list:
        """Returns a ranked subset of candidate_listing_ids judged
        visually similar to the uploaded image."""
        raise NotImplementedError


class SandboxVisualSearchProvider(VisualSearchProvider):
    """A working, deterministic stand-in: matches based on meaningful
    words shared between the uploaded image's filename and a listing's
    photo filenames (e.g. 'bastos-modern-house-1.jpg' matches a query
    photo also containing 'modern' and 'house'). This is NOT real image
    similarity — it exists purely so the ENFORCEMENT/plumbing of visual
    search is real and testable now."""

    _NOISE_WORDS = {
        "https", "http", "www", "com", "jpg", "jpeg", "png", "webp", "gif",
        "example", "uploads", "images", "img", "photo", "photos", "1", "2", "3",
    }

    def _significant_words(self, url: str) -> set:
        cleaned = url.lower().replace("https://", "").replace("http://", "")
        words = cleaned.replace("/", " ").replace("-", " ").replace(".", " ").replace("_", " ").split()
        return {w for w in words if w not in self._NOISE_WORDS and len(w) > 2}

    def find_similar_listings(self, image_url: str, candidate_listing_ids: list) -> list:
        from property.models import Listing
        query_words = self._significant_words(image_url)

        scored = []
        for listing_id in candidate_listing_ids:
            try:
                listing = Listing.objects.get(id=listing_id)
            except Listing.DoesNotExist:
                continue
            listing_words = set()
            for media in listing.property_asset.media.all():
                listing_words |= self._significant_words(media.file_url)
            overlap = len(query_words & listing_words)
            if overlap > 0:
                scored.append((listing_id, overlap))

        scored.sort(key=lambda pair: pair[1], reverse=True)
        return [listing_id for listing_id, score in scored]


class GoogleVisionVisualSearchProvider(VisualSearchProvider):
    """NOT YET CONNECTED — needs GOOGLE_CLOUD_VISION_API_KEY and a
    configured Product Search index."""
    def find_similar_listings(self, image_url: str, candidate_listing_ids: list) -> list:
        raise NotImplementedError("Google Cloud Vision Product Search integration not yet built.")


def get_active_visual_search_provider() -> VisualSearchProvider:
    return SandboxVisualSearchProvider()
