#!/usr/bin/env python3
"""Shared market helpers for the CTO Investissements Python plugin.

Connector tiers (Work-level):
  T1 Stooq — open HTTP API, no key (default)
  T2 Finnhub — open API with FINNHUB_API_KEY / ${FINNHUB_API_KEY}
  T3 Local MCP/CLI — this module + mcp/server.py + scripts/screen_cto.py
  T4 Optional remote MCP — URL provided by user / workspace MCP (not hardcoded)
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

DISCLAIMER = (
    "Information générale uniquement — pas un conseil en investissement, "
    "ni une recommandation personnalisée. Les performances passées ne préjugent "
    "pas des performances futures. Vérifiez fiscalité CTO, frais de courtage et "
    "votre profil de risque avant toute décision."
)

DEFAULT_WATCHLIST = [
    ("MC.PA", "LVMH", "EU"),
    ("OR.PA", "L'Oréal", "EU"),
    ("TTE.PA", "TotalEnergies", "EU"),
    ("SAN.PA", "Sanofi", "EU"),
    ("AIR.PA", "Airbus", "EU"),
    ("ASML.AS", "ASML", "EU"),
    ("SAP.DE", "SAP", "EU"),
    ("NESN.SW", "Nestlé", "EU"),
    ("AAPL.US", "Apple", "US"),
    ("MSFT.US", "Microsoft", "US"),
    ("GOOGL.US", "Alphabet", "US"),
    ("NVDA.US", "NVIDIA", "US"),
]

UA = "BobWork-CTO-Invest/1.2"


def e2e_mode() -> bool:
    if os.environ.get("BOB_CTO_INVEST_E2E", "").strip().lower() in {"1", "true", "e2e"}:
        return True
    marker = os.environ.get("BOB_CTO_INVEST", "").strip().lower()
    return marker.startswith("e2e")


def finnhub_api_key() -> str | None:
    for key in ("FINNHUB_API_KEY", "BOB_FINNHUB_API_KEY"):
        value = os.environ.get(key, "").strip()
        if value and not (value.startswith("${") and value.endswith("}")):
            return value
    return None


def remote_mcp_hint() -> str | None:
    """User/prompt-defined remote MCP URL (not auto-connected; informational)."""
    for key in ("CTO_REMOTE_MCP_URL", "BOB_CTO_REMOTE_MCP_URL"):
        value = os.environ.get(key, "").strip()
        if value and value.startswith("https://") and not value.startswith("${"):
            return value
    return None


def e2e_quotes() -> list[dict[str, Any]]:
    return [
        {"symbol": "MC.PA", "name": "LVMH", "region": "EU", "close": 742.1, "dayChangePct": 1.2, "volume": "420000", "mode": "e2e"},
        {"symbol": "ASML.AS", "name": "ASML", "region": "EU", "close": 812.4, "dayChangePct": 2.4, "volume": "610000", "mode": "e2e"},
        {"symbol": "NVDA.US", "name": "NVIDIA", "region": "US", "close": 118.5, "dayChangePct": 3.1, "volume": "182000000", "mode": "e2e"},
        {"symbol": "MSFT.US", "name": "Microsoft", "region": "US", "close": 428.2, "dayChangePct": 0.8, "volume": "22000000", "mode": "e2e"},
    ]


def fetch_stooq_quote(symbol: str) -> dict[str, Any] | None:
    url = f"https://stooq.com/q/l/?s={urllib.parse.quote(symbol.lower())}&f=sd2t2ohlcv&h&e=csv"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            body = response.read().decode("utf-8", errors="replace").strip().splitlines()
    except (urllib.error.URLError, TimeoutError, OSError):
        return None
    if len(body) < 2:
        return None
    parts = body[1].split(",")
    if len(parts) < 8 or parts[6] in {"", "N/D"}:
        return None
    try:
        close = float(parts[6])
        open_px = float(parts[3]) if parts[3] not in {"", "N/D"} else close
    except ValueError:
        return None
    change_pct = ((close - open_px) / open_px * 100.0) if open_px else 0.0
    return {
        "symbol": symbol.upper(),
        "date": parts[1],
        "time": parts[2],
        "open": open_px,
        "high": parts[4],
        "low": parts[5],
        "close": close,
        "volume": parts[7],
        "dayChangePct": round(change_pct, 2),
        "provider": "stooq",
    }


def stooq_to_finnhub_symbol(symbol: str) -> str:
    """Map Stooq-style symbols to Finnhub (US bare ticker; EU keep as-is when possible)."""
    upper = symbol.upper()
    if upper.endswith(".US"):
        return upper[: -len(".US")]
    return upper


def fetch_finnhub_quote(symbol: str, api_key: str) -> dict[str, Any] | None:
    query = urllib.parse.urlencode({"symbol": stooq_to_finnhub_symbol(symbol), "token": api_key})
    url = f"https://finnhub.io/api/v1/quote?{query}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    try:
        close = float(payload.get("c") or 0)
        previous = float(payload.get("pc") or close)
    except (TypeError, ValueError):
        return None
    if close <= 0:
        return None
    change_pct = ((close - previous) / previous * 100.0) if previous else 0.0
    return {
        "symbol": symbol.upper(),
        "close": close,
        "previousClose": previous,
        "dayChangePct": round(change_pct, 2),
        "high": payload.get("h"),
        "low": payload.get("l"),
        "open": payload.get("o"),
        "provider": "finnhub",
    }


def fetch_quote(symbol: str, company: str, region: str) -> dict[str, Any] | None:
    quote = fetch_stooq_quote(symbol)
    if quote:
        quote["name"] = company
        quote["region"] = region
        return quote
    api_key = finnhub_api_key()
    if not api_key:
        return None
    quote = fetch_finnhub_quote(symbol, api_key)
    if not quote:
        return None
    quote["name"] = company
    quote["region"] = region
    return quote


def resolve_watchlist(symbols: list[str] | None, limit: int) -> list[tuple[str, str, str]]:
    if symbols:
        known = {item[0]: item for item in DEFAULT_WATCHLIST}
        out: list[tuple[str, str, str]] = []
        for symbol in symbols[:limit]:
            key = symbol.strip().upper()
            if not key:
                continue
            out.append(known.get(key, (key, key, "ALL")))
        return out
    return DEFAULT_WATCHLIST[:limit]


def connector_status() -> dict[str, Any]:
    """Declare which connector tiers are active (for agent + UI honesty)."""
    if e2e_mode():
        return with_meta(
            {
                "tiers": {
                    "T1_stooq_open_api": {"available": False, "reason": "e2e-fixture"},
                    "T2_finnhub_api_key": {"available": False, "reason": "e2e-fixture"},
                    "T3_local_mcp_cli": {"available": True, "reason": "bundled"},
                    "T4_remote_mcp_url": {"available": False, "reason": "e2e-fixture"},
                },
                "activeSource": "e2e-fixture",
                "guidance": "Mode fixture e2e : pas d’appel réseau réel.",
            }
        )
    remote = remote_mcp_hint()
    return with_meta(
        {
            "tiers": {
                "T1_stooq_open_api": {
                    "available": True,
                    "reason": "HTTPS public sans clé — source par défaut",
                },
                "T2_finnhub_api_key": {
                    "available": finnhub_api_key() is not None,
                    "reason": "Définir FINNHUB_API_KEY pour fallback / enrichissement US",
                    "env": "FINNHUB_API_KEY",
                },
                "T3_local_mcp_cli": {
                    "available": True,
                    "reason": "mcp/server.py + scripts/screen_cto.py",
                },
                "T4_remote_mcp_url": {
                    "available": remote is not None,
                    "reason": "URL https optionnelle (prompt / Intégrations MCP / CTO_REMOTE_MCP_URL)",
                    "url": remote,
                    "env": "CTO_REMOTE_MCP_URL",
                },
            },
            "activeSource": "stooq+finnhub-fallback" if finnhub_api_key() else "stooq",
            "guidance": (
                "Préférer les tools MCP locaux. Si l’utilisateur fournit un MCP marché "
                "public (URL) ou l’ajoute dans Intégrations → MCP, utiliser use_mcp_tool "
                "sur ce serveur pour enrichir, puis croiser avec le snapshot local."
            ),
        }
    )


def market_snapshot(symbols: list[str] | None = None, limit: int = 12) -> dict[str, Any]:
    if e2e_mode():
        quotes = e2e_quotes()[:limit]
        return with_meta({"quotes": quotes, "source": "e2e-fixture", "count": len(quotes)})

    watchlist = resolve_watchlist(symbols, limit)
    quotes = []
    providers: set[str] = set()
    for symbol, company, region in watchlist:
        quote = fetch_quote(symbol, company, region)
        if not quote:
            continue
        providers.add(str(quote.get("provider") or "unknown"))
        quotes.append(quote)
    source = "+".join(sorted(providers)) if providers else "none"
    return with_meta(
        {
            "quotes": quotes,
            "source": source,
            "count": len(quotes),
            "missing": [item[0] for item in watchlist if item[0] not in {q["symbol"] for q in quotes}],
            "connectors": connector_status().get("tiers"),
        }
    )


def screen_ideas(horizon: str = "moyen", region: str = "ALL", limit: int = 5) -> dict[str, Any]:
    horizon = (horizon or "moyen").strip().lower()
    region = (region or "ALL").strip().upper()
    limit = max(1, min(int(limit or 5), 12))

    if e2e_mode():
        ideas = [
            {"symbol": "ASML.AS", "name": "ASML", "region": "EU", "thesis": "Momentum semi-conducteurs EU + liquidité adaptée CTO.", "dayChangePct": 2.4, "score": 92},
            {"symbol": "NVDA.US", "name": "NVIDIA", "region": "US", "thesis": "Force relative IA / data-center ; volatilité élevée.", "dayChangePct": 3.1, "score": 90},
            {"symbol": "MC.PA", "name": "LVMH", "region": "EU", "thesis": "Large-cap qualité FR, sensible au cycle luxe.", "dayChangePct": 1.2, "score": 78},
        ][:limit]
        return with_meta(
            {
                "ideas": ideas,
                "horizon": horizon,
                "region": region,
                "source": "e2e-fixture",
                "guidance": "Présente 2–3 idées max, cite les chiffres, rappelle le disclaimer CTO, et propose une diversification.",
            }
        )

    symbols = [s for s, _, r in DEFAULT_WATCHLIST if region in {"ALL", r}]
    snapshot = market_snapshot(symbols=symbols, limit=20)
    quotes = snapshot.get("quotes") or []
    if region != "ALL":
        quotes = [q for q in quotes if q.get("region") == region]
    ranked = sorted(quotes, key=lambda item: float(item.get("dayChangePct") or 0), reverse=True)
    ideas = []
    for quote in ranked[:limit]:
        change = float(quote.get("dayChangePct") or 0)
        provider = quote.get("provider") or snapshot.get("source")
        ideas.append(
            {
                "symbol": quote.get("symbol"),
                "name": quote.get("name"),
                "region": quote.get("region"),
                "close": quote.get("close"),
                "dayChangePct": change,
                "score": round(50 + max(min(change * 8, 40), -40), 1),
                "provider": provider,
                "thesis": (
                    f"Variation journalière {change:+.2f}% via {provider}. "
                    f"Horizon {horizon} : à croiser avec valorisation et actualités."
                ),
            }
        )
    return with_meta(
        {
            "ideas": ideas,
            "horizon": horizon,
            "region": region,
            "source": f"{snapshot.get('source')}-screen",
            "guidance": "Cadre les idées comme informatives ; mentionne change (US), frais CTO et risque de perte.",
        }
    )


def with_meta(data: dict[str, Any]) -> dict[str, Any]:
    return {**data, "disclaimer": DISCLAIMER, "asOf": datetime.now(timezone.utc).isoformat()}


def format_brief(payload: dict[str, Any]) -> str:
    lines = [
        f"# Brief CTO — {payload.get('asOf', '')}",
        "",
        payload.get("disclaimer", DISCLAIMER),
        "",
    ]
    ideas = payload.get("ideas") or []
    if ideas:
        lines.append("## Idées (informatif)")
        for idea in ideas:
            lines.append(
                f"- **{idea.get('name')}** (`{idea.get('symbol')}`) "
                f"{float(idea.get('dayChangePct') or 0):+.2f}% — {idea.get('thesis')}"
            )
        lines.append("")
    if payload.get("guidance"):
        lines.append(f"_Guidance_: {payload['guidance']}")
    return "\n".join(lines)


def dumps(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)
