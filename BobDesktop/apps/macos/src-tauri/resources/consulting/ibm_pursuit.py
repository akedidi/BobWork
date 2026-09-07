#!/usr/bin/env python3
"""Shared helpers for the Brief Mission IBM Python plugin.

Open APIs only — no Slack, no Microsoft Graph / Office / Teams / SharePoint.

Connector tiers (Work-level):
  T1 Wikipedia, Wikidata, DuckDuckGo, Google News RSS — no key
  T2 NewsAPI — optional NEWSAPI_KEY / ${NEWSAPI_KEY}
  T3 Local MCP/CLI — this module + mcp/server.py + scripts/brief_pursuit.py
  T4 Optional remote MCP URL — rejected if the host is Slack or Microsoft
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any

DISCLAIMER = (
    "Brief informatif pour préparation d’atelier — ce n’est pas une offre commerciale IBM, "
    "ni un engagement de prix, de délai ou de périmètre. Vérifiez les faits publics, "
    "le contexte compte et les règles d’engagement IBM avant toute proposition client."
)

UA = "BobWork-IBM-Pursuit/1.0 (local consultant brief; open APIs only)"
BLOCKED_REMOTE_HOSTS = (
    "slack.com",
    "microsoft.com",
    "office.com",
    "office365.com",
    "sharepoint.com",
    "onedrive.com",
    "live.com",
    "outlook.com",
    "teams.microsoft.com",
    "graph.microsoft.com",
    "azure.com",
    "windows.net",
)

IBM_PLAYS = [
    {
        "id": "watsonx-data",
        "name": "watsonx.data / lakehouse hybride",
        "offer": "IBM watsonx.data",
        "proofUrl": "https://www.ibm.com/products/watsonx-data",
        "keywords": ("data platform", "lakehouse", "moderniser", "hybride", "lock-in", "multi-cloud", "entrepôt"),
        "fit": "Moderniser la plateforme data sans coller à un seul cloud.",
        "risk": "Gouvernance, latence cross-cloud et compétences Spark/SQL à cadrer.",
        "workshopQuestion": "Où doivent vivre les données d’atelier vs production, et qui en est propriétaire ?",
    },
    {
        "id": "watsonx-ai",
        "name": "watsonx.ai — cas d’usage genAI",
        "offer": "IBM watsonx.ai",
        "proofUrl": "https://www.ibm.com/products/watsonx-ai",
        "keywords": ("ia générative", "genai", "llm", "watsonx", "cas d’usage", "supply chain"),
        "fit": "Industrialiser 2 cas d’usage genAI (extraction, copilote métier) sur un socle gouverné.",
        "risk": "Hallucinations sur données opérationnelles ; besoin de RAG et de garde-fous métier.",
        "workshopQuestion": "Quels 2 parcours supply chain (ex. exceptions, planning) justifient un copilote dès le premier trimestre ?",
    },
    {
        "id": "openshift-hybrid",
        "name": "OpenShift / Cloud Pak — runtime portable",
        "offer": "Red Hat OpenShift + IBM Cloud Pak for Data",
        "proofUrl": "https://www.ibm.com/products/cloud-pak-for-data",
        "keywords": ("lock-in", "cloud unique", "hybride", "openshift", "kubernetes", "portable"),
        "fit": "Exécuter data + IA sur un runtime portable (on-prem / multi-cloud).",
        "risk": "Complexité d’exploitation cluster si l’équipe platform est trop petite.",
        "workshopQuestion": "Quel est le socle d’exécution actuel (AWS, Azure, GCP, on-prem) et ce qui ne doit pas bouger ?",
    },
    {
        "id": "sterling-supply",
        "name": "Supply chain visibility (Sterling)",
        "offer": "IBM Sterling Supply Chain Intelligence",
        "proofUrl": "https://www.ibm.com/products/supply-chain-intelligence-suite",
        "keywords": ("supply chain", "logistique", "stock", "commande", "fournisseur", "planning"),
        "fit": "Relier signaux supply chain aux cas d’usage IA (exceptions, promesse client).",
        "risk": "Intégration EDI/ERP plus longue que le POC genAI ; ne pas promettre un jumeau numérique en 90 min.",
        "workshopQuestion": "Quelles ruptures ou retards sont aujourd’hui vus trop tard, et dans quel système ?",
    },
    {
        "id": "consulting-garage",
        "name": "IBM Consulting — cadrage Garage",
        "offer": "IBM Consulting (méthode Garage / architecture data)",
        "proofUrl": "https://www.ibm.com/consulting",
        "keywords": ("atelier", "cio", "cadrage", "roadmap", "transformation"),
        "fit": "Transformer l’atelier CIO en backlog de 10 jours (décisions, owners, preuves).",
        "risk": "Glisser vers une offre commerciale pendant l’atelier ; rester sur faits et questions.",
        "workshopQuestion": "Quelle décision le CIO doit pouvoir prendre à J+10, et avec quelles preuves ?",
    },
]


def e2e_mode() -> bool:
    if os.environ.get("BOB_IBM_PURSUIT_E2E", "").strip().lower() in {"1", "true", "e2e"}:
        return True
    marker = os.environ.get("BOB_IBM_PURSUIT", "").strip().lower()
    return marker.startswith("e2e")


def newsapi_key() -> str | None:
    for key in ("NEWSAPI_KEY", "BOB_NEWSAPI_KEY"):
        value = os.environ.get(key, "").strip()
        if value and not (value.startswith("${") and value.endswith("}")):
            return value
    return None


def remote_mcp_hint() -> str | None:
    for key in ("IBM_PURSUIT_REMOTE_MCP_URL", "BOB_IBM_PURSUIT_REMOTE_MCP_URL"):
        value = os.environ.get(key, "").strip()
        if value.startswith("https://") and not value.startswith("${"):
            if is_blocked_remote(value):
                return None
            return value
    return None


def is_blocked_remote(url: str) -> bool:
    host = urllib.parse.urlparse(url).hostname or ""
    host = host.lower()
    return any(host == blocked or host.endswith(f".{blocked}") for blocked in BLOCKED_REMOTE_HOSTS)


def http_get(url: str, timeout: int = 12) -> str | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError):
        return None


def fetch_wikipedia_summary(company: str) -> dict[str, Any] | None:
    title = urllib.parse.quote(company.strip().replace(" ", "_"))
    for lang in ("fr", "en"):
        body = http_get(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title}")
        if not body:
            continue
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            continue
        extract = (payload.get("extract") or "").strip()
        if not extract:
            continue
        return {
            "provider": f"wikipedia-{lang}",
            "title": payload.get("title") or company,
            "extract": extract[:900],
            "url": payload.get("content_urls", {}).get("desktop", {}).get("page")
            or f"https://{lang}.wikipedia.org/wiki/{title}",
        }
    return None


def fetch_wikidata(company: str) -> dict[str, Any] | None:
    query = urllib.parse.urlencode(
        {
            "action": "wbsearchentities",
            "search": company,
            "language": "fr",
            "format": "json",
            "limit": 1,
            "type": "item",
        }
    )
    body = http_get(f"https://www.wikidata.org/w/api.php?{query}")
    if not body:
        return None
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return None
    hits = payload.get("search") or []
    if not hits:
        return None
    hit = hits[0]
    return {
        "provider": "wikidata",
        "id": hit.get("id"),
        "label": hit.get("label"),
        "description": hit.get("description"),
        "url": hit.get("concepturi") or hit.get("url"),
    }


def fetch_duckduckgo(company: str) -> dict[str, Any] | None:
    query = urllib.parse.urlencode(
        {"q": company, "format": "json", "no_html": 1, "skip_disambig": 1}
    )
    body = http_get(f"https://api.duckduckgo.com/?{query}")
    if not body:
        return None
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return None
    abstract = (payload.get("AbstractText") or "").strip()
    related = []
    for item in payload.get("RelatedTopics") or []:
        if isinstance(item, dict) and item.get("Text"):
            related.append(item["Text"][:180])
        if len(related) >= 3:
            break
    if not abstract and not related:
        return None
    return {
        "provider": "duckduckgo",
        "abstract": abstract[:700] or None,
        "related": related,
        "url": payload.get("AbstractURL") or None,
    }


def fetch_google_news_rss(company: str, country: str) -> list[dict[str, str]]:
    hl = "fr" if (country or "").upper() in {"FR", "FRANCE"} else "en"
    query = urllib.parse.urlencode({"q": company, "hl": hl, "gl": hl.upper()[:2], "ceid": f"{hl.upper()[:2]}:{hl}"})
    body = http_get(f"https://news.google.com/rss/search?{query}")
    if not body:
        return []
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return []
    items: list[dict[str, str]] = []
    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        if title:
            items.append({"title": title[:200], "url": link, "published": pub, "provider": "google-news-rss"})
        if len(items) >= 5:
            break
    return items


def fetch_newsapi(company: str) -> list[dict[str, str]]:
    api_key = newsapi_key()
    if not api_key:
        return []
    query = urllib.parse.urlencode(
        {"q": company, "language": "fr", "sortBy": "publishedAt", "pageSize": 5, "apiKey": api_key}
    )
    body = http_get(f"https://newsapi.org/v2/everything?{query}")
    if not body:
        return []
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return []
    articles = []
    for article in payload.get("articles") or []:
        title = (article.get("title") or "").strip()
        if not title:
            continue
        articles.append(
            {
                "title": title[:200],
                "url": article.get("url") or "",
                "published": article.get("publishedAt") or "",
                "provider": "newsapi",
            }
        )
        if len(articles) >= 5:
            break
    return articles


def e2e_snapshot(company: str) -> dict[str, Any]:
    return {
        "company": company or "Schneider Electric",
        "country": "France",
        "sector": "industrie",
        "source": "e2e-fixture",
        "facts": [
            "Groupe industriel français, coté, spécialisé énergie et automatisation.",
            "Présence mondiale, clients usines / bâtiments / data centers / réseaux.",
            "Portefeuille software + hardware (gestion de l’énergie, industrial automation).",
            "Enjeux publics : efficacité énergétique, digitalisation des opérations, supply chain.",
            "Contrainte atelier : moderniser la data platform sans lock-in cloud unique.",
        ],
        "signals": [
            {"title": "Accélération des offres digitales énergie / industrie", "provider": "e2e", "url": ""},
            {"title": "Pression sur la visibilité supply chain et les délais fournisseurs", "provider": "e2e", "url": ""},
            {"title": "Intérêt CIO pour genAI gouvernée plutôt que chat public", "provider": "e2e", "url": ""},
        ],
        "wikipedia": {"provider": "e2e", "extract": "Schneider Electric — fixture e2e."},
    }


def connector_status() -> dict[str, Any]:
    if e2e_mode():
        return with_meta(
            {
                "tiers": {
                    "T1_open_apis": {
                        "available": False,
                        "reason": "e2e-fixture",
                        "providers": ["wikipedia", "wikidata", "duckduckgo", "google-news-rss"],
                    },
                    "T2_newsapi_key": {"available": False, "reason": "e2e-fixture", "env": "NEWSAPI_KEY"},
                    "T3_local_mcp_cli": {"available": True, "reason": "bundled"},
                    "T4_remote_mcp_url": {
                        "available": False,
                        "reason": "ignoré en e2e — Slack / Microsoft jamais utilisés",
                    },
                },
                "blockedIntegrations": ["slack", "microsoft-graph", "teams", "sharepoint", "outlook"],
                "activeSource": "e2e-fixture",
                "guidance": "APIs ouvertes uniquement. Pas Slack, pas Microsoft.",
            }
        )
    remote = remote_mcp_hint()
    return with_meta(
        {
            "tiers": {
                "T1_open_apis": {
                    "available": True,
                    "reason": "Wikipedia, Wikidata, DuckDuckGo, Google News RSS — sans clé",
                    "providers": ["wikipedia", "wikidata", "duckduckgo", "google-news-rss"],
                },
                "T2_newsapi_key": {
                    "available": newsapi_key() is not None,
                    "reason": "Optionnel : NEWSAPI_KEY pour enrichir les actus",
                    "env": "NEWSAPI_KEY",
                },
                "T3_local_mcp_cli": {
                    "available": True,
                    "reason": "mcp/server.py + scripts/brief_pursuit.py",
                },
                "T4_remote_mcp_url": {
                    "available": remote is not None,
                    "reason": (
                        "URL https optionnelle, hors Slack et Microsoft. "
                        "Laisser vide : le brief se construit sur T1–T3."
                    ),
                    "url": remote,
                    "env": "IBM_PURSUIT_REMOTE_MCP_URL",
                },
            },
            "blockedIntegrations": ["slack", "microsoft-graph", "teams", "sharepoint", "outlook", "onedrive"],
            "activeSource": "open-apis+newsapi" if newsapi_key() else "open-apis",
            "guidance": (
                "Utiliser ibm_connector_status → ibm_client_snapshot → ibm_screen_plays. "
                "Ne jamais appeler Slack, Teams, Outlook, SharePoint ou Graph."
            ),
        }
    )


def client_snapshot(
    company: str,
    country: str = "France",
    sector: str = "industrie",
) -> dict[str, Any]:
    company = (company or "").strip() or "Schneider Electric"
    country = (country or "France").strip()
    sector = (sector or "industrie").strip()
    if e2e_mode():
        payload = e2e_snapshot(company)
        payload["country"] = country
        payload["sector"] = sector
        return with_meta(payload)

    wiki = fetch_wikipedia_summary(company)
    wikidata = fetch_wikidata(company)
    ddg = fetch_duckduckgo(company)
    headlines = fetch_google_news_rss(company, country)
    newsapi = fetch_newsapi(company)
    signals = (newsapi + headlines)[:5]
    facts: list[str] = []
    if wiki and wiki.get("extract"):
        facts.extend(_split_facts(wiki["extract"], 3))
    if wikidata and wikidata.get("description"):
        facts.append(str(wikidata["description"]))
    if ddg and ddg.get("abstract"):
        facts.extend(_split_facts(str(ddg["abstract"]), 2))
    facts = _unique(facts)[:5]
    while len(facts) < 5:
        facts.append(f"À confirmer en atelier : {sector} / {country} / {company}.")
    return with_meta(
        {
            "company": company,
            "country": country,
            "sector": sector,
            "source": connector_status().get("activeSource"),
            "facts": facts,
            "signals": signals[:3],
            "wikipedia": wiki,
            "wikidata": wikidata,
            "duckduckgo": ddg,
            "connectors": connector_status().get("tiers"),
        }
    )


def screen_plays(
    objective: str = "",
    sector: str = "industrie",
    constraints: str = "",
    limit: int = 4,
) -> dict[str, Any]:
    limit = max(1, min(int(limit or 4), 4))
    blob = f"{objective} {sector} {constraints}".lower()
    scored: list[tuple[int, dict[str, Any]]] = []
    for play in IBM_PLAYS:
        score = sum(4 if keyword in blob else 0 for keyword in play["keywords"])
        if "lock-in" in blob and play["id"] in {"watsonx-data", "openshift-hybrid"}:
            score += 6
        if "supply" in blob and play["id"] in {"watsonx-ai", "sterling-supply"}:
            score += 6
        scored.append((score + 1, play))
    ranked = [play for _, play in sorted(scored, key=lambda item: item[0], reverse=True)[:limit]]
    plays = []
    for play in ranked:
        plays.append(
            {
                "id": play["id"],
                "name": play["name"],
                "offer": play["offer"],
                "proofUrl": play["proofUrl"],
                "fit": play["fit"],
                "risk": play["risk"],
                "workshopQuestion": play["workshopQuestion"],
            }
        )
    return with_meta(
        {
            "plays": plays,
            "objective": objective,
            "sector": sector,
            "constraints": constraints,
            "source": "local-playbook+open-apis",
            "guidance": (
                "3–4 plays max. Chaque ligne : preuve publique IBM, offre, risque, question d’atelier. "
                "Pas de prix, pas d’offre commerciale, pas de connecteur Slack/Microsoft."
            ),
        }
    )


def _split_facts(text: str, limit: int) -> list[str]:
    parts = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
    return parts[:limit]


def _unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def with_meta(data: dict[str, Any]) -> dict[str, Any]:
    return {**data, "disclaimer": DISCLAIMER, "asOf": datetime.now(timezone.utc).isoformat()}


def format_brief(snapshot: dict[str, Any], plays: dict[str, Any]) -> str:
    lines = [
        f"# Brief mission IBM — {snapshot.get('company', '')}",
        "",
        snapshot.get("disclaimer", DISCLAIMER),
        "",
        "## Snapshot",
    ]
    for fact in snapshot.get("facts") or []:
        lines.append(f"- {fact}")
    lines.append("")
    lines.append("## Signaux")
    for signal in snapshot.get("signals") or []:
        title = signal.get("title") if isinstance(signal, dict) else str(signal)
        lines.append(f"- {title}")
    lines.append("")
    lines.append("## Plays IBM")
    for play in plays.get("plays") or []:
        lines.append(
            f"- **{play.get('name')}** ({play.get('offer')}) — {play.get('fit')} "
            f"Preuve : {play.get('proofUrl')}"
        )
    if plays.get("guidance"):
        lines.extend(["", f"_Guidance_: {plays['guidance']}"])
    return "\n".join(lines)


def dumps(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)
