#!/usr/bin/env python3
"""CLI entrypoint for the CTO Investissements Python plugin.

Usage:
  python3 scripts/screen_cto.py --horizon moyen --region ALL --limit 5
  python3 scripts/screen_cto.py --json
  python3 scripts/screen_cto.py --snapshot --json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import cto_market  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Screen d’idées CTO (informatif, Python local).")
    parser.add_argument("--horizon", default="moyen", choices=["court", "moyen", "long"])
    parser.add_argument("--region", default="ALL", choices=["EU", "US", "ALL"])
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--json", action="store_true", help="Sortie JSON brute")
    parser.add_argument("--snapshot", action="store_true", help="Afficher seulement le snapshot marché")
    args = parser.parse_args(argv)

    if args.snapshot:
        payload = cto_market.market_snapshot(limit=max(args.limit, 8))
        print(cto_market.dumps(payload))
        return 0

    payload = cto_market.screen_ideas(horizon=args.horizon, region=args.region, limit=args.limit)
    print(cto_market.dumps(payload) if args.json else cto_market.format_brief(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
