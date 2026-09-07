#!/usr/bin/env python3
"""CLI wrapper: `python3 scripts/docling_cli.py convert report.pdf --to md`."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import docling_runtime  # noqa: E402

if __name__ == "__main__":
    sys.exit(docling_runtime.main(sys.argv[1:]))
