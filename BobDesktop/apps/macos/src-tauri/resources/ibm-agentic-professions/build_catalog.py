#!/usr/bin/env python3
"""Compatibility entry point for rebuilding the embedded IBM plugin archive.

Plugin sources under ``plugins/`` are authoritative and may contain newer hand
maintained skills. This command deliberately packages them without regenerating
or deleting source files.
"""

from __future__ import annotations

import runpy
from pathlib import Path


PACKAGER = (
    Path(__file__).resolve().parents[3]
    / "scripts"
    / "build-embedded-plugin-archives.py"
)


if __name__ == "__main__":
    runpy.run_path(str(PACKAGER), run_name="__main__")
