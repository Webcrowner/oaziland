"""
marketplace.search_assist — help for the marketplace search box: "did you mean" spelling fixes, English/French
synonyms (so "couch" finds a "sofa" and "canapé" finds both), trending searches, and search by photo.

Searches are logged anonymously (no user id or address is stored) as running totals plus a per-day count used to
rank what is trending over a window.
"""
import base64
import hashlib
import logging
import random
import re
import unicodedata
from datetime import timedelta
from difflib import get_close_matches

import requests
from django.conf import settings
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import F, Q, QuerySet, Sum
from django.utils import timezone

logger = logging.getLogger(__name__)

VOCABULARY_CACHE_KEY = "mkt-search:vocab:v1"
VOCABULARY_TTL_SECONDS = 600
VOCABULARY_MAX_TITLES = 5000
DID_YOU_MEAN_CUTOFF = 0.75
MIN_TYPO_WORD_LENGTH = 4
MAX_QUERY_UNITS = 8

MIN_TERM_LENGTH = 3
MAX_TERM_LENGTH = 60
REPEAT_WINDOW_SECONDS = 60
KEEP_DAYS = 30
PRUNE_ONE_IN = 50
MAX_TRENDING = 8

VISION_URL = "https://vision.googleapis.com/v1/images:annotate"
VISION_TIMEOUT_SECONDS = 10
MAX_KEYWORDS = 5
MIN_LABEL_SCORE = 0.6
# Labels that describe nearly every photo and would make a useless search.
GENERIC_LABELS = frozenset({
    "product", "material", "font", "pattern", "design", "rectangle", "circle", "line", "text", "art", "gadget",
    "technology", "electronics", "tints and shades", "automotive design", "household hardware",
    "metal", "plastic", "wood", "number", "symmetry", "parallel", "logo", "brand", "graphics", "illustration",
})

# Each group is words/phrases that mean the same thing to a shopper in Cameroon (English and French).
SYNONYM_GROUPS = (
    ("sofa", "couch", "settee", "canapé", "divan"),
    ("phone", "mobile", "smartphone", "cellphone", "telephone", "téléphone", "portable", "mobile phone"),
    ("tv", "television", "télé", "télévision"),
    ("fridge", "refrigerator", "frigo", "réfrigérateur"),
    ("freezer", "congélateur"),
    ("laptop", "notebook", "ordinateur portable", "pc portable"),
    ("computer", "ordinateur", "pc", "desktop"),
    ("tablet", "tablette"),
    ("printer", "imprimante"),
    ("camera", "caméra", "appareil photo"),
    ("headphones", "earphones", "écouteurs", "casque"),
    ("speaker", "enceinte", "haut parleur"),
    ("car", "vehicle", "voiture", "auto", "automobile"),
    ("motorbike", "motorcycle", "moto", "bike"),
    ("bicycle", "cycle", "vélo"),
    ("truck", "lorry", "camion"),
    ("van", "minibus", "fourgon"),
    ("tyre", "tire", "pneu"),
    ("engine", "moteur"),
    ("battery", "batterie"),
    ("shop", "store", "boutique", "magasin"),
    ("house", "home", "maison"),
    ("apartment", "flat", "appartement"),
    ("room", "chambre"),
    ("land", "terrain", "plot", "parcelle"),
    ("warehouse", "depot", "dépôt", "entrepôt", "hangar"),
    ("office", "bureau"),
    ("generator", "groupe électrogène", "genset"),
    ("inverter", "onduleur"),
    ("solar panel", "panneau solaire"),
    ("cooker", "stove", "cuisinière"),
    ("oven", "four"),
    ("microwave", "micro ondes"),
    ("blender", "mixeur"),
    ("washing machine", "washer", "machine à laver", "lave linge"),
    ("fan", "ventilateur"),
    ("air conditioner", "air conditioning", "climatiseur", "climatisation", "clim"),
    ("bed", "lit"),
    ("mattress", "matelas"),
    ("chair", "chaise"),
    ("wardrobe", "closet", "armoire", "garde robe"),
    ("furniture", "meuble", "meubles", "mobilier"),
    ("kitchen", "cuisine"),
    ("clothes", "clothing", "vêtements", "habits"),
    ("shoes", "shoe", "sneakers", "chaussures", "chaussure"),
    ("bag", "sac", "handbag", "sac à main"),
    ("watch", "montre"),
    ("used", "occasion", "second hand"),
    ("new", "neuf", "neuve"),
    ("dog", "puppy", "chien", "chiot"),
)


def fold(text: str) -> str:
    """Lower-cased and accent-free, for comparing what people type with what is stored."""
    decomposed = unicodedata.normalize("NFKD", (text or "").lower())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def _build_index() -> dict:
    index: dict = {}
    for group in SYNONYM_GROUPS:
        for phrase in group:
            index.setdefault(fold(phrase), []).append(group)
    return index


_SYNONYM_INDEX = _build_index()
_MAX_PHRASE_WORDS = max(len(key.split()) for key in _SYNONYM_INDEX)


def _tokens(q: str) -> list:
    return re.findall(r"\w+", q or "")


def _groups_for(folded_phrase: str):
    groups = _SYNONYM_INDEX.get(folded_phrase)
    if groups is None and folded_phrase.endswith("s"):
        groups = _SYNONYM_INDEX.get(folded_phrase[:-1])
    return groups


def expand_terms(q: str) -> list:
    """One list per word (or known phrase, such as "ordinateur portable") of the query: the word as typed first,
    then its synonyms. "used couch" gives [["used", "occasion", "second hand"], ["couch", "sofa", ...]]."""
    words = _tokens(q)[:MAX_QUERY_UNITS * 2]
    folded = [fold(word) for word in words]
    units = []
    position = 0
    while position < len(words) and len(units) < MAX_QUERY_UNITS:
        for size in range(min(_MAX_PHRASE_WORDS, len(words) - position), 0, -1):
            groups = _groups_for(" ".join(folded[position:position + size]))
            if groups:
                break
        else:
            size, groups = 1, None
        typed = " ".join(words[position:position + size])
        alternatives = [typed]
        seen = {fold(typed)}
        for group in groups or ():
            for phrase in group:
                if fold(phrase) not in seen:
                    seen.add(fold(phrase))
                    alternatives.append(phrase)
        units.append(alternatives)
        position += size
    return units


def listing_text_q(q: str, *, is_car: bool = False) -> Q:
    """The filter behind the marketplace search box: the whole phrase, or every word (each with its synonyms)."""
    def matches(text):
        match = Q(title__icontains=text) | Q(description__icontains=text)
        if is_car:
            match |= Q(vehicle_spec__make__icontains=text) | Q(vehicle_spec__model__icontains=text)
        return match

    combined = matches(q)
    units = expand_terms(q)
    if units:
        every_word = Q()
        for alternatives in units:
            word_match = Q()
            for alternative in alternatives:
                word_match |= matches(alternative)
            every_word &= word_match
        combined |= every_word
    return combined


def _cache_get(key):
    try:
        return cache.get(key)
    except Exception:  # A cache outage must never break a search.
        return None


def _cache_set(key, value, timeout):
    try:
        cache.set(key, value, timeout)
    except Exception:
        pass


def _cache_add(key, timeout) -> bool:
    """True when the key was new (or the cache is down, so nothing can be de-duplicated)."""
    try:
        return bool(cache.add(key, 1, timeout))
    except Exception:
        return True


def vocabulary() -> list:
    """Real words from the titles of live listings, plus the synonym words, cached for ten minutes."""
    words = _cache_get(VOCABULARY_CACHE_KEY)
    if words is not None:
        return words
    from .models import AvailabilityStatus, MarketplaceListingBase
    titles = MarketplaceListingBase.objects.filter(
        availability_status=AvailabilityStatus.AVAILABLE, removed_by_moderation=False,
    ).order_by("-created_at").values_list("title", flat=True)[:VOCABULARY_MAX_TITLES]
    found = set()
    for title in titles:
        found.update(word for word in _tokens(fold(title)) if len(word) >= 3)
    for phrase in _SYNONYM_INDEX:
        found.update(phrase.split())
    words = sorted(found)
    _cache_set(VOCABULARY_CACHE_KEY, words, VOCABULARY_TTL_SECONDS)
    return words


def did_you_mean(q: str):
    """The query with misspelt words replaced by the closest real word, or None when nothing needs fixing."""
    q = (q or "").strip()
    if not q:
        return None
    words = vocabulary()
    known = set(words)
    corrected = q
    changed = False
    for match in reversed(list(re.finditer(r"\w+", q))):
        word = fold(match.group())
        if len(word) < MIN_TYPO_WORD_LENGTH or word.isdigit() or word in known:
            continue
        # A plural, or half-typed word, is not a typo.
        if (word.endswith("s") and word[:-1] in known) or any(candidate.startswith(word) for candidate in words):
            continue
        close = get_close_matches(word, words, n=1, cutoff=DID_YOU_MEAN_CUTOFF)
        if close:
            corrected = corrected[:match.start()] + close[0] + corrected[match.end():]
            changed = True
    if not changed or fold(corrected) == fold(q):
        return None
    return corrected


def normalise_term(q: str) -> str:
    return " ".join(unicodedata.normalize("NFC", (q or "")).lower().split())


def _loggable(term: str) -> bool:
    if not (MIN_TERM_LENGTH <= len(term) <= MAX_TERM_LENGTH):
        return False
    if re.search(r"https?:|www\.|://|@", term):
        return False
    return bool(re.search(r"[^\W\d_]", term))  # Needs at least one letter: phone numbers and ids are skipped.


def _bump(model, lookup: dict, create: dict, update: dict):
    """Atomic +1 on the row's count, creating the row the first time (and surviving a concurrent create)."""
    if model.objects.filter(**lookup).update(count=F("count") + 1, **update):
        return
    try:
        with transaction.atomic():
            model.objects.create(**lookup, count=1, **create)
    except IntegrityError:
        model.objects.filter(**lookup).update(count=F("count") + 1, **update)


def record_search(q: str, results_count: int, user=None, client=None) -> bool:
    """Counts one search of `q`. The same person (signed-in account or `client` key) repeating a phrase within a
    minute counts once. Only the phrase and result count are stored, never who searched."""
    from discovery.models import MarketplaceSearchTerm, MarketplaceSearchTermDay
    term = normalise_term(q)
    if not _loggable(term):
        return False
    who = client or (f"u{user.pk}" if user is not None and getattr(user, "is_authenticated", False) else "")
    if who:
        digest = hashlib.sha1(f"{who}|{term}".encode("utf-8")).hexdigest()
        if not _cache_add(f"mkt-search:seen:{digest}", REPEAT_WINDOW_SECONDS):
            return False
    now = timezone.now()
    results = max(0, int(results_count or 0))
    _bump(MarketplaceSearchTerm, {"term": term}, {"last_searched_at": now, "results_last": results},
          {"last_searched_at": now, "results_last": results})
    _bump(MarketplaceSearchTermDay, {"term": term, "day": timezone.localdate()}, {}, {})
    if random.randrange(PRUNE_ONE_IN) == 0:
        prune_old_days()
    return True


def prune_old_days() -> int:
    from discovery.models import MarketplaceSearchTermDay
    cutoff = timezone.localdate() - timedelta(days=KEEP_DAYS)
    return MarketplaceSearchTermDay.objects.filter(day__lt=cutoff).delete()[0]


def trending_searches(days: int = 7, limit: int = MAX_TRENDING) -> list:
    """The most searched phrases of the last `days` days, hiding any whose latest search found nothing."""
    from discovery.models import MarketplaceSearchTerm, MarketplaceSearchTermDay
    days = max(1, min(int(days), KEEP_DAYS))
    limit = max(1, min(int(limit), MAX_TRENDING))
    since = timezone.localdate() - timedelta(days=days - 1)
    ranked = list(
        MarketplaceSearchTermDay.objects.filter(day__gte=since).values("term").annotate(total=Sum("count"))
        .order_by("-total", "term")[:limit * 5]
    )
    empty = set(MarketplaceSearchTerm.objects.filter(
        term__in=[row["term"] for row in ranked], results_last=0,
    ).values_list("term", flat=True))
    return [{"term": row["term"], "count": row["total"]} for row in ranked if row["term"] not in empty][:limit]


def _client_key(request) -> str:
    user = getattr(request, "user", None)
    if user is not None and user.is_authenticated:
        return f"u{user.pk}"
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
    return "a" + (forwarded or request.META.get("REMOTE_ADDR", ""))


def _result_count(results) -> int:
    if isinstance(results, int):
        return results
    return results.count() if isinstance(results, QuerySet) else len(results)


def log_from_request(request, q, results) -> None:
    """Logs a first-page marketplace search; `results` is the result count, or the queryset/list behind it.
    Never raises: a logging problem must not break browsing."""
    try:
        if not q or request.query_params.get("page", "1") not in ("", "1"):
            return
        if not _loggable(normalise_term(q)):
            return
        record_search(q, _result_count(results), client=_client_key(request))
    except Exception:
        logger.exception("Could not log marketplace search")


class VisualSearchUnavailable(Exception):
    """No Vision key is configured, or Google could not be reached."""


def _best_keywords(annotation: dict) -> list:
    scored = []
    for item in annotation.get("localizedObjectAnnotations", []):
        # Objects are specific ("Couch") where labels are broad ("Furniture"), so they get a head start.
        scored.append((float(item.get("score", 0)) + 0.1, item.get("name", "")))
    for item in annotation.get("labelAnnotations", []):
        if float(item.get("score", 0)) >= MIN_LABEL_SCORE:
            scored.append((float(item.get("score", 0)), item.get("description", "")))
    keywords, seen = [], set()
    for _, name in sorted(scored, key=lambda pair: -pair[0]):
        key = fold(name).strip()
        if key and key not in seen and key not in GENERIC_LABELS:
            seen.add(key)
            keywords.append(name.strip().lower())
        if len(keywords) == MAX_KEYWORDS:
            break
    return keywords


def describe_image_keywords(image) -> list:
    """What a photo shows, as search words (best first): Google Vision label and object detection on image bytes
    or a public image URL. The image itself is never logged."""
    api_key = getattr(settings, "GOOGLE_CLOUD_VISION_API_KEY", "")
    if not api_key:
        raise VisualSearchUnavailable("Visual search is not configured.")
    if isinstance(image, (bytes, bytearray)):
        source = {"content": base64.b64encode(bytes(image)).decode("ascii")}
    else:
        source = {"source": {"imageUri": str(image)}}
    body = {"requests": [{"image": source, "features": [
        {"type": "LABEL_DETECTION", "maxResults": 10}, {"type": "OBJECT_LOCALIZATION", "maxResults": 10},
    ]}]}
    try:
        response = requests.post(VISION_URL, json=body, headers={"X-Goog-Api-Key": api_key}, timeout=VISION_TIMEOUT_SECONDS)
        response.raise_for_status()
        annotation = response.json()["responses"][0]
    except (requests.RequestException, ValueError, KeyError, IndexError):
        logger.warning("Google Vision image search failed")
        raise VisualSearchUnavailable("Visual search could not be reached.")
    if annotation.get("error"):
        logger.warning("Google Vision rejected an image search: %s", annotation["error"].get("message", ""))
        raise VisualSearchUnavailable("Visual search could not read the image.")
    return _best_keywords(annotation)
