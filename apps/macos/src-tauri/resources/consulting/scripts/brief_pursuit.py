#!/usr/bin/env python3
"""CLI entrypoint for the Brief Mission IBM Python plugin.

Usage:
  python3 scripts/brief_pursuit.py --company "Schneider Electric" --json
  python3 scripts/brief_pursuit.py --status --json
  python3 scripts/brief_pursuit.py --company "Schneider Electric" --objective "data + genAI supply chain"
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import ibm_pursuit  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Brief mission IBM (informatif, APIs ouvertes).")
    parser.add_argument("--company", default="Schneider Electric")
    parser.add_argument("--country", default="France")
    parser.add_argument("--sector", default="industrie")
    parser.add_argument("--objective", default="")
    parser.add_argument("--constraints", default="")
    parser.add_argument("--limit", type=int, default=4)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--status", action="store_true")
    args = parser.parse_args(argv)

    if args.status:
        payload = ibm_pursuit.connector_status()
        print(ibm_pursuit.dumps(payload))
        return 0

    snapshot = ibm_pursuit.client_snapshot(args.company, args.country, args.sector)
    plays = ibm_pursuit.screen_plays(args.objective, args.sector, args.constraints, args.limit)
    if args.json:
        print(ibm_pursuit.dumps({"snapshot": snapshot, "plays": plays}))
        return 0
    print(ibm_pursuit.format_brief(snapshot, plays))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
