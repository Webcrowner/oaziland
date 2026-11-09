"""
Category-specific details for goods, like Jiji's phone fields (brand, storage, RAM…) — each kept small and
filterable. Stored in GoodsListing.attributes and checked against the schema of the listing's item category.
"""
TEXT, INT, CHOICE = "text", "int", "choice"

STORAGE_GB = [8, 16, 32, 64, 128, 256, 512, 1024, 2048]
RAM_GB = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 64]

SCHEMAS = {
    "PHONES": {
        "brand": {"type": TEXT, "max": 40, "filter": True},
        "model": {"type": TEXT, "max": 60},
        "storage_gb": {"type": CHOICE, "values": STORAGE_GB, "filter": True},
        "ram_gb": {"type": CHOICE, "values": RAM_GB, "filter": True},
        "color": {"type": TEXT, "max": 30},
        "battery_health_pct": {"type": INT, "min": 1, "max": 100},
    },
    "ELECTRONICS": {
        "brand": {"type": TEXT, "max": 40, "filter": True},
        "model": {"type": TEXT, "max": 60},
        "warranty_months": {"type": INT, "min": 0, "max": 60},
    },
    "FASHION": {
        "size": {"type": TEXT, "max": 10, "filter": True},
        "color": {"type": TEXT, "max": 30},
        "brand": {"type": TEXT, "max": 40, "filter": True},
        "gender": {"type": CHOICE, "values": ["MEN", "WOMEN", "UNISEX", "KIDS"], "filter": True},
    },
    "APPLIANCES": {
        "brand": {"type": TEXT, "max": 40, "filter": True},
        "power_source": {"type": CHOICE, "values": ["ELECTRIC", "GAS", "SOLAR", "BATTERY", "MANUAL"], "filter": True},
        "warranty_months": {"type": INT, "min": 0, "max": 60},
    },
    "HOME": {
        "material": {"type": TEXT, "max": 40, "filter": True},
        "color": {"type": TEXT, "max": 30},
        "dimensions": {"type": TEXT, "max": 60},
    },
    "VEHICLE_PARTS": {
        "fits_make": {"type": TEXT, "max": 40, "filter": True},
        "fits_model": {"type": TEXT, "max": 60, "filter": True},
        "part_number": {"type": TEXT, "max": 60, "filter": True},
    },
}


class AttributeError_(ValueError):
    pass


def clean_attributes(item_category: str, value) -> dict:
    """The attributes with blanks dropped and each value of the right type, or AttributeError_ naming the problem."""
    if value in (None, ""):
        return {}
    if not isinstance(value, dict):
        raise AttributeError_("Details must be an object.")
    schema = SCHEMAS.get(item_category, {})
    cleaned = {}
    for key, item in value.items():
        if item in (None, ""):
            continue
        spec = schema.get(key)
        if spec is None:
            raise AttributeError_(f"\"{key}\" isn't a detail for this category.")
        if spec["type"] == TEXT:
            if not isinstance(item, str) or len(item.strip()) > spec["max"]:
                raise AttributeError_(f"{key}: enter up to {spec['max']} characters.")
            item = item.strip()
        elif spec["type"] == INT:
            if isinstance(item, bool) or not isinstance(item, int) or not spec["min"] <= item <= spec["max"]:
                raise AttributeError_(f"{key}: enter a whole number from {spec['min']} to {spec['max']}.")
        elif item not in spec["values"]:
            raise AttributeError_(f"{key}: choose one of {', '.join(map(str, spec['values']))}.")
        cleaned[key] = item
    return cleaned


def parse_attribute_filters(item_category: str, params) -> dict:
    """attr_<key>=value browse filters for the filterable attributes of the chosen goods category."""
    filters = {}
    for key, spec in SCHEMAS.get(item_category, {}).items():
        raw = (params.get(f"attr_{key}") or "").strip()
        if not raw or not spec.get("filter"):
            continue
        if spec["type"] == CHOICE:
            value = int(raw) if isinstance(spec["values"][0], int) and raw.isdigit() else raw
            if value not in spec["values"]:
                raise AttributeError_(f"attr_{key}: choose one of {', '.join(map(str, spec['values']))}.")
            filters[key] = ("exact", value)
        else:
            filters[key] = ("icontains", raw[:60])
    return filters
