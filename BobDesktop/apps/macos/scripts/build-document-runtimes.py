#!/usr/bin/env python3
"""Rebuild bundled, checksum-verified macOS document engines from official releases."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1] / 'src-tauri/resources/shared-runtimes/documents'
for source in json.loads((ROOT / 'sources.json').read_text()):
    output = ROOT / f"{source['engine']}-{source['platform']}.zip"
    with tempfile.TemporaryDirectory() as temporary:
        archive = Path(temporary) / 'release'
        subprocess.run(['curl', '-fLSs', '--retry', '3', source['url'], '-o', str(archive)], check=True)
        raw = archive.read_bytes()
        if hashlib.sha256(raw).hexdigest() != source['sha256']:
            raise RuntimeError(f"Checksum mismatch: {source['url']}")
        files = {}
        if source['url'].endswith('.tar.gz'):
            with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as release:
                for entry in release.getmembers():
                    if entry.isfile() and (Path(entry.name).name == source['engine'] or 'LICENSE' in entry.name.upper()):
                        files[Path(entry.name).name] = release.extractfile(entry).read()
        else:
            with zipfile.ZipFile(io.BytesIO(raw)) as release:
                for name in release.namelist():
                    if Path(name).name == source['engine'] or 'COPYRIGHT' in name.upper() or 'LICENSE' in name.upper():
                        files[Path(name).name] = release.read(name)
        if source['engine'] not in files:
            raise RuntimeError('Missing engine executable')
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
            for name, data in sorted(files.items()):
                info = zipfile.ZipInfo('bin/' + name if name == source['engine'] else 'licenses/' + name)
                info.external_attr = (0o100755 if name == source['engine'] else 0o100644) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                bundle.writestr(info, data)
            bundle.writestr('source.json', json.dumps(source, indent=2))
        print(output.name, output.stat().st_size, flush=True)
