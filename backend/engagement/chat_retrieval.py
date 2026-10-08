"""engagement.chat_retrieval — turns a chat message into real, linkable search results.

The support chatbot used to quote listings with no way for the user to open them. This module
detects the area, budget and kind of place a visitor is asking about, queries the live database, and
produces PLATFORM DATA lines that always carry a site path (e.g. /listing/<id>, or an area page such as
/search?quarter=<id>) so the AI can hand the user a working link even when nothing matches.
"""
import re
import unicodedata
from decimal import Decimal, InvalidOperation

from django.db.models import Min

MAX_RESULTS = 5
GENERIC_QUARTER_NAMES = {"centre ville", "plateau", "village"}  # only meaningful next to a city name


def _norm(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", ascii_text).strip()


def _contains(haystack: str, needle: str) -> bool:
    return bool(needle) and f" {needle} " in f" {haystack} "


# ---------------------------------------------------------------- intent / filters
_PROPERTY_WORDS = (
    "house", "houses", "apartment", "apartments", "flat", "studio", "land", "plot", "terrain", "shop", "villa",
    "rent", "rental", "rentals", "buy", "purchase", "sale", "property", "properties", "listing", "listings",
    "bedroom", "maison", "appartement", "louer", "acheter", "boutique", "chambre", "room",
)


def detect_intents(text: str) -> set:
    t = _norm(text)
    words = set(t.split())
    intents = set()
    if words & {"hotel", "hotels", "hotel", "stay", "accommodation", "hebergement"}:
        intents.add("hotel")
    if words & {"hostel", "hostels", "student", "students", "campus", "dorm", "residence", "etudiant", "etudiants"}:
        intents.add("hostel")
    if _contains(t, "guest house") or words & {"guesthouse", "guesthouses", "lodge", "airbnb"}:
        intents.add("guest_house")
    if words & {"venue", "venues", "wedding", "conference", "banquet", "hall", "event", "events", "salle"}:
        intents.add("venue")
    if words & set(_PROPERTY_WORDS):
        # "room" next to a hotel/hostel word means a hotel/hostel room, not a rental listing.
        only_room = (words & set(_PROPERTY_WORDS)) <= {"room", "chambre"}
        if not (only_room and intents):
            intents.add("property")
    return intents


def detect_listing_type(text: str):
    words = set(_norm(text).split())
    if words & {"rent", "rental", "rentals", "louer", "location"}:
        return "RENT"
    if words & {"buy", "purchase", "sale", "acheter", "achat"}:
        return "SALE"
    return None


def detect_property_type(text: str):
    words = set(_norm(text).split())
    if words & {"land", "plot", "terrain", "terrains"}:
        return "LAND"
    if words & {"shop", "boutique", "store"}:
        return "SHOP"
    if words & {"house", "houses", "villa", "maison"}:
        return "HOUSE"
    return None


_MILLION_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:million|millions|m)\b")
_THOUSAND_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:k|thousand|mille)\b")
_GROUPED_RE = re.compile(r"\b(\d{1,3}(?:[ ,.]\d{3})+)\b")
_PLAIN_RE = re.compile(r"\b(\d{4,})\b")


def detect_price_range(text: str):
    """Returns (min_xaf, max_xaf) — either may be None. A single amount is a ceiling unless the
    wording says 'above/over/at least/from'."""
    t = text.lower()
    amount = None
    for regex, factor in ((_MILLION_RE, 1_000_000), (_THOUSAND_RE, 1_000)):
        match = regex.search(t)
        if match:
            try:
                amount = Decimal(match.group(1).replace(",", ".")) * factor
            except InvalidOperation:
                amount = None
            break
    if amount is None:
        match = _GROUPED_RE.search(t) or _PLAIN_RE.search(t)
        if match:
            digits = re.sub(r"[ ,.]", "", match.group(1))
            value = Decimal(digits)
            if not (1900 <= value <= 2100) and value >= 5000:  # skip years and tiny numbers
                amount = value
    if amount is None:
        return None, None
    if re.search(r"\b(above|over|more than|at least|minimum)\b", t):
        return amount, None
    return None, amount


# ---------------------------------------------------------------- area detection
class Area:
    """What place the user means. `broad` means a whole city/term with many neighborhoods, so results
    are summarised per neighborhood instead of linking one page."""

    def __init__(self, quarters=None, label="", broad=False, ambiguous=None):
        self.quarters = quarters or []
        self._label = label
        self.broad = broad
        self.ambiguous = ambiguous or []  # [(quarter name, [city names])]

    @property
    def found(self) -> bool:
        return bool(self.quarters)

    @property
    def label(self) -> str:
        if self._label:
            return self._label
        return " / ".join(f"{q.name} ({q.village_or_district.name})" for q in self.quarters)

    def quarter_ids(self):
        return [q.id for q in self.quarters] if self.quarters else None


# Words that appear in many place names but never identify one on their own.
PLACE_STOPWORDS = {
    "area", "centre", "center", "ville", "commercial", "resort", "campus", "beach", "beachfront", "city", "town",
    "road", "street", "quarter", "district", "market", "checkpoint", "village", "plateau", "nord", "north",
}


def detect_area(text: str) -> Area:
    from geo.models import Quarter, VillageOrDistrict

    haystack = _norm(text)
    if not haystack:
        return Area()
    words = {w for w in haystack.split() if len(w) >= 4 and w not in PLACE_STOPWORDS}
    cities = [d for d in VillageOrDistrict.objects.all() if _contains(haystack, _norm(d.name))]
    city_ids = {c.id for c in cities}
    all_quarters = list(Quarter.objects.select_related("village_or_district"))

    by_name = {}
    for quarter in all_quarters:
        name = _norm(quarter.name)
        if _contains(haystack, name):
            by_name.setdefault(name, []).append(quarter)

    chosen, ambiguous = [], []
    for name, candidates in by_name.items():
        in_city = [q for q in candidates if q.village_or_district_id in city_ids]
        if name in GENERIC_QUARTER_NAMES:
            chosen.extend(in_city)  # generic names only count when their city is named too
        elif in_city:
            chosen.extend(in_city)
        elif len(candidates) == 1:
            chosen.extend(candidates)
        else:
            ambiguous.append((candidates[0].name, sorted({q.village_or_district.name for q in candidates})))

    if not chosen and ambiguous:
        return Area(ambiguous=ambiguous)

    # A typed word like "kribi" should reach every place whose name or district contains it
    # ("Kribi Beachfront Resort Area" in district "Kribi Beach" as well as the city of Kribi).
    matched = list(chosen)
    for city in cities:
        matched.extend(q for q in all_quarters if q.village_or_district_id == city.id)
    for quarter in all_quarters:
        name_words = set(_norm(quarter.name).split()) | set(_norm(quarter.village_or_district.name).split())
        if words & name_words:
            matched.append(quarter)

    unique = list({q.id: q for q in matched}.values())
    if not unique:
        return Area()
    broad = (bool(cities) and not chosen) or len(unique) > 5
    label = ""
    if broad:
        label = cities[0].name if cities else " / ".join(sorted(words & {w for q in unique for w in _norm(q.name).split()}))
        label = label.title() if label else "the requested area"
    return Area(quarters=unique, label=label, broad=broad)


# ---------------------------------------------------------------- formatting helpers
def _money(value) -> str:
    return f"{int(Decimal(value))} XAF"


def _budget_text(price_min, price_max) -> str:
    if price_max is not None:
        return f"up to {_money(price_max)}"
    if price_min is not None:
        return f"from {_money(price_min)}"
    return "no budget given"


def _query(path: str, **params) -> str:
    parts = [f"{k}={v}" for k, v in params.items() if v not in (None, "")]
    return f"{path}?{'&'.join(parts)}" if parts else path


def _area_links(area: Area, path: str, **extra) -> list:
    """Links to the area's own page(s): one per quarter (none for a broad city-level area)."""
    if area.quarters and not area.broad:
        return [(f"{q.name} ({q.village_or_district.name})", _query(path, quarter=q.id, **extra)) for q in area.quarters]
    return []


def _neighborhood_lines(qs, area: Area, path: str, quarter_field: str = "quarter", **extra) -> list:
    """For a broad area: which neighborhoods have results, each with its own page link."""
    from django.db.models import Count
    # Rebuild from pks: a prior annotate() would otherwise stop values().annotate() grouping by neighborhood.
    qs = qs.model.objects.filter(pk__in=qs.values("pk"))
    rows = (
        qs.values(quarter_field, f"{quarter_field}__name", f"{quarter_field}__village_or_district__name")
        .annotate(n=Count("pk")).order_by("-n")[:MAX_RESULTS]
    )
    lines = [f"- {area.label} covers several neighborhoods. Neighborhoods there with results:"]
    for row in rows:
        lines.append(
            f"  - {row[f'{quarter_field}__name']} ({row[f'{quarter_field}__village_or_district__name']}): {row['n']} — "
            f"{_query(path, quarter=row[quarter_field], **extra)}"
        )
    if not rows:
        lines.append(f"  - none yet. General page: {_query(path, **extra)}")
    return lines


def _no_area_lines(area: Area, kind: str, general_link: str, popular: list) -> list:
    lines = [f"- The user did not name a specific area for {kind}. Ask which neighborhood or city they want (and their budget if relevant)."]
    for name, cities in area.ambiguous:
        lines.append(f"- '{name}' exists in several cities ({', '.join(cities)}) — ask which one they mean.")
    if popular:
        lines.append("- Areas that currently have results: " + "; ".join(f"{label} — {count} ({link})" for label, count, link in popular))
    lines.append(f"- General page (no area filter): {general_link}")
    return lines


# ---------------------------------------------------------------- per-vertical sections
def property_section(area, price_min, price_max, listing_type, property_type) -> str:
    from property.models import Listing, ListingStatus

    qs = Listing.objects.filter(status=ListingStatus.PUBLISHED).select_related(
        "property_asset", "property_asset__quarter", "property_asset__quarter__village_or_district",
    )
    if listing_type:
        qs = qs.filter(listing_type=listing_type)
    if property_type:
        qs = qs.filter(property_asset__type=property_type)

    kind = {"RENT": "rentals", "SALE": "properties for sale"}.get(listing_type, "properties")
    header = f"PROPERTY SEARCH — {kind}; area: {area.label or 'not specified'}; budget: {_budget_text(price_min, price_max)}"
    link_extra = {"listing_type": listing_type}
    general_link = _query("/search", listing_type=listing_type, max_price=int(price_max) if price_max else None)

    if not area.found:
        from django.db.models import Count
        top = (
            qs.values("property_asset__quarter", "property_asset__quarter__name", "property_asset__quarter__village_or_district__name")
            .annotate(n=Count("id")).order_by("-n")[:4]
        )
        popular = [
            (f"{row['property_asset__quarter__name']} ({row['property_asset__quarter__village_or_district__name']})", row["n"],
             _query("/search", quarter=row["property_asset__quarter"], **link_extra))
            for row in top
        ]
        return "\n".join([header] + _no_area_lines(area, kind, general_link, popular))

    quarter_ids = area.quarter_ids() or []
    in_area = qs.filter(property_asset__quarter_id__in=quarter_ids)
    matching = in_area
    if price_max is not None:
        matching = matching.filter(price_xaf__lte=price_max)
    if price_min is not None:
        matching = matching.filter(price_xaf__gte=price_min)

    lines = [header]
    total_in_area = in_area.count()
    matches = list(matching.order_by("price_xaf")[:MAX_RESULTS])
    if matches:
        lines.append(f"- {matching.count()} matching listing(s), cheapest first:")
        for l in matches:
            q = l.property_asset.quarter
            lines.append(
                f"  - {l.property_asset.get_type_display()} in {q.name} ({q.village_or_district.name}), "
                f"{l.get_listing_type_display()}, {_money(l.price_xaf)} — link: /listing/{l.id}"
            )
    elif total_in_area:
        cheapest = in_area.order_by("price_xaf").first()
        lines.append(f"- NO listing in this area matches the requested budget/filters. {total_in_area} listing(s) exist in the area without the budget limit.")
        lines.append(
            f"- Closest option: {cheapest.property_asset.get_type_display()} at {_money(cheapest.price_xaf)} — link: /listing/{cheapest.id}"
        )
    else:
        lines.append("- NO published listings exist in this area right now (new ones are added regularly).")

    if not area.broad:
        for label, link in _area_links(area, "/search", **link_extra, max_price=int(price_max) if price_max else None):
            lines.append(f"- Area page for {label} (show it even if nothing matched): {link}")
    else:
        lines.extend(_neighborhood_lines(in_area, area, "/search", quarter_field="property_asset__quarter", **link_extra))
    return "\n".join(lines)


def hotel_section(area, price_min, price_max) -> str:
    from hotels.models import Hotel

    qs = Hotel.objects.filter(verified=True).select_related("quarter", "quarter__village_or_district").annotate(min_rate=Min("room_types__base_rate_xaf"))
    header = f"HOTEL SEARCH — area: {area.label or 'not specified'}; budget per night: {_budget_text(price_min, price_max)}"
    general = _query("/hotels", max_price=int(price_max) if price_max else None)
    if not area.found:
        popular = []
        for h in qs.order_by("min_rate")[:4]:
            popular.append((f"{h.quarter.name} ({h.quarter.village_or_district.name})", 1, _query("/hotels", quarter=h.quarter_id)))
        return "\n".join([header] + _no_area_lines(area, "a hotel stay", general, popular))

    in_area = qs.filter(quarter_id__in=area.quarter_ids() or [])
    matching = in_area
    if price_max is not None:
        matching = matching.filter(min_rate__lte=price_max)
    if price_min is not None:
        matching = matching.filter(min_rate__gte=price_min)
    lines = [header]
    matches = list(matching.order_by("min_rate")[:MAX_RESULTS])
    if matches:
        lines.append("- Matching hotels, cheapest room first:")
        for h in matches:
            rate = f"from {_money(h.min_rate)}/night" if h.min_rate is not None else "price on request"
            lines.append(f"  - Hotel in {h.quarter.name} ({h.quarter.village_or_district.name}), {rate} — link: /hotels/{h.id}")
    elif in_area.exists():
        cheapest = in_area.order_by("min_rate").first()
        lines.append("- NO hotel in this area fits the requested budget.")
        if cheapest.min_rate is not None:
            lines.append(f"- Cheapest available: from {_money(cheapest.min_rate)}/night — link: /hotels/{cheapest.id}")
    else:
        lines.append("- NO verified hotels listed in this area right now.")
    area_pages = _area_links(area, "/hotels", max_price=int(price_max) if price_max else None)
    for label, link in area_pages:
        lines.append(f"- Hotels page for {label} (show it even if nothing matched): {link}")
    if area.broad:
        lines.extend(_neighborhood_lines(in_area, area, "/hotels", max_price=int(price_max) if price_max else None))
    return "\n".join(lines)


def hostel_section(area, price_min, price_max) -> str:
    from student_hostels.models import StudentHostel, HostelUnit

    header = f"STUDENT HOSTEL SEARCH — area: {area.label or 'not specified'}; budget per semester: {_budget_text(price_min, price_max)}"
    qs = StudentHostel.objects.select_related("quarter", "quarter__village_or_district")
    if not area.found:
        popular = [(f"{h.quarter.name} ({h.quarter.village_or_district.name})", 1, _query("/student-hostels", quarter=h.quarter_id)) for h in qs[:4]]
        return "\n".join([header] + _no_area_lines(area, "a student hostel", "/student-hostels", popular))

    in_area = qs.filter(quarter_id__in=area.quarter_ids() or [])
    hostels = list(in_area[:30])
    cheapest = {
        row["building"]: row["m"]
        for row in HostelUnit.objects.filter(building__in=[h.pk for h in hostels]).values("building").annotate(m=Min("price_xaf"))
    }
    rows = []
    for h in hostels:
        price = cheapest.get(h.pk)
        if price_max is not None and (price is None or price > price_max):
            continue
        if price_min is not None and (price is None or price < price_min):
            continue
        rows.append((price if price is not None else Decimal("999999999"), h, price))
    rows.sort(key=lambda r: r[0])

    lines = [header]
    if rows:
        lines.append("- Matching student hostels, cheapest unit first:")
        for _, h, price in rows[:MAX_RESULTS]:
            text = f"from {_money(price)}/semester" if price is not None else "price on request"
            lines.append(f"  - Student hostel in {h.quarter.name} ({h.quarter.village_or_district.name}), {text} — link: /student-hostels/{h.pk}")
    elif hostels:
        lines.append("- NO hostel in this area fits the requested budget.")
    else:
        lines.append("- NO student hostels listed in this area right now.")
    for label, link in _area_links(area, "/student-hostels"):
        lines.append(f"- Student hostels page for {label} (show it even if nothing matched): {link}")
    if area.broad:
        lines.extend(_neighborhood_lines(in_area, area, "/student-hostels"))
    return "\n".join(lines)


def guest_house_section(area) -> str:
    from property.models import GuestHouseLodge

    header = f"GUEST HOUSE SEARCH — area: {area.label or 'not specified'} (nightly prices are shown on each guest house page)"
    qs = GuestHouseLodge.objects.select_related("quarter", "quarter__village_or_district")
    if not area.found:
        popular = [(f"{g.quarter.name} ({g.quarter.village_or_district.name})", 1, _query("/guest-houses", quarter=g.quarter_id)) for g in qs[:4]]
        return "\n".join([header] + _no_area_lines(area, "a guest house", "/guest-houses", popular))
    in_area = qs.filter(quarter_id__in=area.quarter_ids() or [])
    houses = list(in_area[:MAX_RESULTS])
    lines = [header]
    if houses:
        lines.append("- Guest houses found:")
        for g in houses:
            lines.append(f"  - Guest house in {g.quarter.name} ({g.quarter.village_or_district.name}) — link: /guest-houses/{g.pk}")
    else:
        lines.append("- NO guest houses listed in this area right now.")
    for label, link in _area_links(area, "/guest-houses"):
        lines.append(f"- Guest houses page for {label} (show it even if nothing matched): {link}")
    if area.broad:
        lines.extend(_neighborhood_lines(in_area, area, "/guest-houses"))
    return "\n".join(lines)


def venue_section(area, price_min, price_max) -> str:
    from events.models import Venue

    header = f"EVENT VENUE SEARCH — area: {area.label or 'not specified'}; budget per hour: {_budget_text(price_min, price_max)}"
    qs = Venue.objects.select_related("quarter", "quarter__village_or_district").annotate(min_rate=Min("spaces__base_price_per_hour_xaf"))
    if not area.found:
        popular = [(f"{v.quarter.name} ({v.quarter.village_or_district.name})", 1, _query("/events", quarter=v.quarter_id)) for v in qs[:4]]
        return "\n".join([header] + _no_area_lines(area, "an event venue", "/events", popular))
    in_area = qs.filter(quarter_id__in=area.quarter_ids() or [])
    matching = in_area
    if price_max is not None:
        matching = matching.filter(min_rate__lte=price_max)
    if price_min is not None:
        matching = matching.filter(min_rate__gte=price_min)
    lines = [header]
    venues = list(matching.order_by("min_rate")[:MAX_RESULTS])
    if venues:
        lines.append("- Matching venues, cheapest first:")
        for v in venues:
            rate = f"from {_money(v.min_rate)}/hour" if v.min_rate is not None else "price on request"
            lines.append(f"  - Venue in {v.quarter.name} ({v.quarter.village_or_district.name}), {rate} — link: /events/{v.pk}")
    elif in_area.exists():
        lines.append("- NO venue in this area fits the requested budget.")
    else:
        lines.append("- NO event venues listed in this area right now.")
    for label, link in _area_links(area, "/events"):
        lines.append(f"- Event venues page for {label} (show it even if nothing matched): {link}")
    if area.broad:
        lines.extend(_neighborhood_lines(in_area, area, "/events"))
    return "\n".join(lines)


# ---------------------------------------------------------------- entry point
def build_discovery_sections(*, message: str, history: list | None = None) -> list:
    """Sections for property / hotel / hostel / guest-house / venue questions. `history` is the earlier
    chat (dicts with sender_type + text) so a follow-up like 'and in Akwa?' still knows the topic."""
    previous_user_texts = [h["text"] for h in reversed(history or []) if h.get("sender_type") == "USER" and h.get("text")][:4]
    texts = [message] + previous_user_texts  # latest first

    def first(detector, empty):
        for text in texts:
            result = detector(text)
            if result != empty:
                return result
        return empty

    intents = first(detect_intents, set())
    if not intents:
        return []
    area = Area()
    for text in texts:
        area = detect_area(text)
        if area.found or area.ambiguous:
            break
    price_min, price_max = first(detect_price_range, (None, None))
    listing_type = first(detect_listing_type, None)
    property_type = first(detect_property_type, None)

    sections = []
    if "property" in intents:
        sections.append(property_section(area, price_min, price_max, listing_type, property_type))
    if "hotel" in intents:
        sections.append(hotel_section(area, price_min, price_max))
    if "hostel" in intents:
        sections.append(hostel_section(area, price_min, price_max))
    if "guest_house" in intents:
        sections.append(guest_house_section(area))
    if "venue" in intents:
        sections.append(venue_section(area, price_min, price_max))
    return sections


# ---------------------------------------------------------------- buttons for the live chat
_ITEM_RE = re.compile(r"^\s*- (.+?) — link: (/\S+)$")
_PAGE_RE = re.compile(r"^- .+? page for (.+?) \(show it even if nothing matched\): (/\S+)$")
_NEIGHBORHOOD_RE = re.compile(r"^\s*- (.+?): (\d+) — (/\S+)$")
_POPULAR_RE = re.compile(r"(.+?) — (\d+) \((/[^)]+)\)")
_GENERAL_RE = re.compile(r"^- General page[^:]*: (/\S+)$")
_NOUNS = {
    "/search": ("listing", "listings"), "/hotels": ("hotel", "hotels"), "/student-hostels": ("hostel", "hostels"),
    "/guest-houses": ("guest house", "guest houses"), "/events": ("venue", "venues"),
}
_AREA_PREFIX = {
    "/hotels": "Hotels in", "/student-hostels": "Student hostels in", "/guest-houses": "Guest houses in", "/events": "Venues in",
}


def _vertical(path: str) -> str:
    return "/" + path.lstrip("/").split("?")[0].split("/")[0]


def _thousands(text: str) -> str:
    return re.sub(r"\b\d{4,}\b", lambda m: f"{int(m.group()):,}", text)


def _area_label(path: str, place: str) -> str:
    vertical = _vertical(path)
    if vertical == "/search":
        prefix = "Rentals in" if "listing_type=RENT" in path else "Properties for sale in" if "listing_type=SALE" in path else "Properties in"
    else:
        prefix = _AREA_PREFIX.get(vertical, "Browse")
    return f"{prefix} {place}"


def _count_label(path: str, place: str, count: int) -> str:
    singular, plural = _NOUNS.get(_vertical(path), ("result", "results"))
    return f"{place} — {count} {singular if count == 1 else plural}"


def extract_actions(sections: list) -> list:
    """Buttons for the live chat, read from the sections this module just wrote (so the format above and
    these patterns must stay together): area pages first, then the best matches, and the general page
    only when nothing else applies. Built here rather than by the AI so links are never missing or mangled."""
    areas, items, general = [], [], []
    for line in "\n".join(sections).splitlines():
        if match := _PAGE_RE.match(line):
            areas.append({"label": _area_label(match.group(2), match.group(1)), "path": match.group(2)})
        elif match := _ITEM_RE.match(line):
            label = re.sub(r"^(Closest option|Cheapest available): ", "", match.group(1))
            items.append({"label": _thousands(label)[:80], "path": match.group(2)})
        elif match := _NEIGHBORHOOD_RE.match(line):
            areas.append({"label": _count_label(match.group(3), match.group(1), int(match.group(2))), "path": match.group(3)})
        elif line.startswith("- Areas that currently have results: "):
            for popular in _POPULAR_RE.finditer(line.split(": ", 1)[1]):
                areas.append({"label": _count_label(popular.group(3), popular.group(1).strip(), int(popular.group(2))), "path": popular.group(3)})
        elif match := _GENERAL_RE.match(line):
            general.append({"label": "Browse all", "path": match.group(1)})

    ordered, seen = [], set()
    for button in areas[:4] + items[:3] or general[:1]:
        if button["path"] not in seen:
            seen.add(button["path"])
            ordered.append(button)
    return ordered
