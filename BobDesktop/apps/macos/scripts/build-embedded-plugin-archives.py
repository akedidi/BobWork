#!/usr/bin/env python3
"""Rebuild embedded plugin archives from their current inspectable sources.

This packager never regenerates or edits plugin source files. It only makes the
archive consumed by Rust match those files byte for byte.
"""

from __future__ import annotations

import os
import tempfile
import zipfile
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parent.parent
IBM_ROOT = APP_ROOT / "src-tauri/resources/ibm-agentic-professions"
IBM_PLUGINS = IBM_ROOT / "plugins"
IBM_ARCHIVE = IBM_ROOT / "ibm-agentic-professions.zip"


def build_archive(source: Path, destination: Path) -> tuple[int, int]:
    files = sorted(path for path in source.rglob("*") if path.is_file())
    destination.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
    )
    os.close(handle)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(
            temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
        ) as archive:
            for path in files:
                info = zipfile.ZipInfo(
                    path.relative_to(source).as_posix(),
                    date_time=(2026, 1, 1, 0, 0, 0),
                )
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                archive.writestr(info, path.read_bytes())
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return len(files), destination.stat().st_size


def main() -> None:
    count, size = build_archive(IBM_PLUGINS, IBM_ARCHIVE)
    print(f"Packed {count} current plugin files into {IBM_ARCHIVE} ({size} bytes)")


if __name__ == "__main__":
    main()
