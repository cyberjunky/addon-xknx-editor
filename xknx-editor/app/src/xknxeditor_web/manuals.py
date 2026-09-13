"""Best-effort lookup of a device's manual: a web search for the application description or
technical manual, preferring PDFs on the manufacturer's own site, otherwise the manufacturer
homepage. What the search uses is whatever the device carries - manufacturer, order number,
product name, application name, or an order number read out of the product reference - so it
still works for devices whose catalog data came from a project rather than a product file.

The KNX device database is not queried: its list page ignores the `title` parameter and returns no
device links, so "open the search instead" would open an empty page. The fallback is a web search
with the same terms.
"""

from __future__ import annotations

import logging
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

log = logging.getLogger(__name__)

TIMEOUT = 20.0
UA = {"User-Agent": "Mozilla/5.0 (compatible; xknx-editor-addon)"}

# Keyed by a lowercase substring of the catalog manufacturer name; first match wins, so more
# specific keys come before shorter ones they contain.
MANUFACTURER_DOMAINS: dict[str, str] = {
    "siemens": "siemens.com", "busch": "busch-jaeger.de", "abb": "abb.com", "jung": "jung.de",
    "berker": "berker.com", "gira": "gira.com", "hager": "hager.com", "insta gmbh": "insta.de",
    "legrand": "legrand.com", "merten": "merten.de", "gewiss": "gewiss.com", "feller": "feller.ch",
    "vimar": "vimar.com", "theben": "theben.de", "somfy": "somfy.com", "zennio": "zennio.com",
    "mdt": "mdt.de", "weinzierl": "weinzierl.de", "elsner": "elsner-elektronik.de", "ekinex": "ekinex.com",
    "schneider": "se.com", "esylux": "esylux.com", "steinel": "steinel.de", "enertex": "enertex.de",
    "lingg": "lingg-janke.de", "ise gmbh": "ise.de", "basalte": "basalte.be", "iddero": "iddero.com",
    "arcus": "arcus-eds.de", "lunatone": "lunatone.com", "eelectron": "eelectron.com", "intesis": "intesis.com",
    "divus": "divus.eu", "warema": "warema.de", "b.e.g": "beg-luxomat.com", "peaknx": "peaknx.com",
    "1home": "1home.io", "casambi": "casambi.com", "dinuy": "dinuy.com", "blumotix": "blumotix.it",
    "tapko": "tapko.de", "ipas": "ipas-products.com", "interra": "interratechnology.com",
}
_KNXDOC_HINTS = ("knxappl", "applikationsbeschreibung", "application-description", "thb", "technisches-handbuch", "technisches_handbuch", "technical-manual")
_DATASHEET_HINTS = ("_ds_", "-ds-", "datenblatt", "datasheet", "_db_")


def domain_for(manufacturer: str | None) -> str | None:
    if not manufacturer:
        return None
    name = manufacturer.lower()
    return next((d for kw, d in MANUFACTURER_DOMAINS.items() if kw in name), None)


def clean(value: str | None) -> str:
    """A field the catalog leaves empty shows as "-"; treat that as nothing."""
    text = (value or "").strip()
    return "" if text in {"-", "--"} else text


def order_from_ref(product_ref: str | None) -> str:
    """``M-000C_H-6305.2019-1_P-6305.2099`` -> ``6305`` - enough to find the product when the
    catalog has no order number of its own (product data imported from a project)."""
    match = re.search(r"_H-([0-9][0-9A-Za-z.\-]*)", clean(product_ref))
    if not match:
        return ""
    return match.group(1).split(".")[0]


def search_url(*fields: str | None) -> str:
    """A web search over the terms a device does have."""
    terms = [t for t in dict.fromkeys(clean(f) for f in fields) if t]
    query = " ".join(terms[:4]) or "KNX"
    if "knx" not in query.lower():
        query = f"KNX {query}"
    return f"https://www.google.com/search?q={urllib.parse.quote_plus(query + ' manual')}"


def _get(url: str, params: dict[str, str] | None = None) -> str | None:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        log.debug("doc fetch failed %s: %s", url, exc)
        return None


def _ddg(query: str) -> list[str]:
    html = _get("https://html.duckduckgo.com/html/", {"q": query})
    if not html:
        return []
    urls = [urllib.parse.unquote(u) for u in re.findall(r"uddg=([^\"&]+)", html)]
    return urls or re.findall(r'class="result__a"[^>]+href="([^"]+)"', html)


def rank(url: str) -> int | None:
    low = url.lower()
    if not low.endswith(".pdf"):
        return None
    if any(h in low for h in _KNXDOC_HINTS):
        return 0
    if any(h in low for h in _DATASHEET_HINTS):
        return 2
    return 1


def _host(url: str) -> str:
    return (urllib.parse.urlparse(url).hostname or "").lower()


def _on_domain(url: str, domain: str | None) -> bool:
    return bool(domain) and (_host(url) == domain or _host(url).endswith("." + str(domain)))


def _foreign(url: str, own: str | None) -> bool:
    host = _host(url)
    return any((host == d or host.endswith("." + d)) and d != own for d in MANUFACTURER_DOMAINS.values())


def resolve_manual(
    manufacturer: str | None,
    order_number: str | None,
    product_name: str | None = None,
    application_name: str | None = None,
    product_ref: str | None = None,
) -> dict[str, Any]:
    order = clean(order_number) or order_from_ref(product_ref)
    name = clean(product_name)
    application = clean(application_name)
    search = search_url(manufacturer, order, name, application)
    keys = [k for k in dict.fromkeys([order, name, application]) if k]
    domain = domain_for(manufacturer)
    if not keys:
        return {"url": f"https://{domain}" if domain else None, "source": "manufacturer", "search": search}
    mfr = clean(manufacturer)
    mfr_word = mfr.split()[0].lower() if mfr else ""
    best: tuple[int, int, str] | None = None
    fallback: str | None = None
    for suffix in ("Applikationsbeschreibung", "Technisches Handbuch", "manual"):
        for key in keys:
            prefix = "" if mfr_word and mfr_word in key.lower() else f"{mfr} "
            urls = _ddg(f"{prefix}{key} {suffix}".strip())
            if fallback is None:
                fallback = next((u for u in urls if not _foreign(u, domain)), None)
            for url in urls:
                r = rank(url)
                if r is None or _foreign(url, domain):
                    continue
                cand = (r, 0 if _on_domain(url, domain) else 1, url)
                if best is None or cand[:2] < best[:2]:
                    best = cand
        if best is not None and best[0] == 0 and best[1] == 0:
            break
    if best is not None:
        return {"url": best[2], "source": "web", "search": search}
    if fallback:
        return {"url": fallback, "source": "web-page", "search": search}
    return {"url": f"https://{domain}" if domain else None, "source": "manufacturer", "search": search}
