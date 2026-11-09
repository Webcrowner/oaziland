"""
visitors.geo — where a visitor is, from their IP address, without sending that
address to any third party.

Sources, best first:
  1. Location headers set by the hosting layer (Cloudflare "CF-IPCountry" and
     friends, Vercel "x-vercel-ip-*") — country plus region and city.
  2. An optional MaxMind City database (.mmdb) configured with
     settings.VISITOR_GEOIP_CITY_DB (needs the `geoip2` package).
  3. The bundled offline country database (geoip2fast) — country only.
Anything that cannot be resolved comes back empty rather than guessed.
"""
import ipaddress
import logging
from dataclasses import dataclass
from urllib.parse import unquote

from django.conf import settings

logger = logging.getLogger(__name__)

_UNKNOWN_COUNTRIES = {"", "XX", "T1", "--", "ZZ"}


@dataclass
class GeoInfo:
    country_code: str = ""
    region: str = ""
    city: str = ""


def is_public_ip(ip: str) -> bool:
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return address.is_global


def _clean_country(code: str) -> str:
    code = (code or "").strip().upper()
    return "" if code in _UNKNOWN_COUNTRIES or len(code) != 2 or not code.isalpha() else code


def from_headers(meta) -> GeoInfo:
    """Location headers added by a CDN/host. Only trusted when the API sits behind one."""
    if not getattr(settings, "VISITOR_TRUST_FORWARDED_FOR", True):
        return GeoInfo()
    country = _clean_country(meta.get("HTTP_CF_IPCOUNTRY") or meta.get("HTTP_X_VERCEL_IP_COUNTRY") or "")
    if not country:
        return GeoInfo()
    region = meta.get("HTTP_CF_REGION") or meta.get("HTTP_X_VERCEL_IP_COUNTRY_REGION") or ""
    city = meta.get("HTTP_CF_IPCITY") or meta.get("HTTP_X_VERCEL_IP_CITY") or ""
    return GeoInfo(country, unquote(region)[:100], unquote(city)[:100])


_maxmind_reader = None
_maxmind_failed = False


def _get_maxmind_reader():
    global _maxmind_reader, _maxmind_failed
    path = getattr(settings, "VISITOR_GEOIP_CITY_DB", "")
    if not path or _maxmind_failed:
        return None
    if _maxmind_reader is None:
        try:
            import geoip2.database
            _maxmind_reader = geoip2.database.Reader(path)
        except Exception:
            _maxmind_failed = True
            logger.warning("Could not open the GeoIP city database at %s; falling back to country-only.", path)
            return None
    return _maxmind_reader


def from_maxmind(ip: str) -> GeoInfo:
    reader = _get_maxmind_reader()
    if reader is None:
        return GeoInfo()
    try:
        response = reader.city(ip)
    except Exception:
        return GeoInfo()
    return GeoInfo(
        _clean_country(response.country.iso_code or ""),
        (response.subdivisions.most_specific.name or "")[:100],
        (response.city.name or "")[:100],
    )


_country_db = None
_country_db_failed = False


def from_country_database(ip: str) -> GeoInfo:
    global _country_db, _country_db_failed
    if _country_db_failed:
        return GeoInfo()
    try:
        if _country_db is None:
            from geoip2fast import GeoIP2Fast
            _country_db = GeoIP2Fast(verbose=False)
        return GeoInfo(_clean_country(_country_db.lookup(ip).country_code))
    except Exception:
        _country_db_failed = True
        logger.warning("The offline country database is unavailable; visitor countries will be unknown.")
        return GeoInfo()


def locate(ip: str, meta) -> GeoInfo:
    """Best available location for a visitor. Private/local addresses have none."""
    found = from_headers(meta)
    if found.country_code and found.city:
        return found
    if not is_public_ip(ip):
        return found
    fallback = from_maxmind(ip)
    if not fallback.country_code:
        fallback = from_country_database(ip)
    if found.country_code:
        # keep the header's country, borrow detail only if it agrees
        if fallback.country_code == found.country_code:
            found.region = found.region or fallback.region
            found.city = found.city or fallback.city
        return found
    return fallback
