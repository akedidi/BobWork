# Native documents in Bob Work

Bob Work ships Tectonic 0.17.0 and Pandoc 3.11 for macOS arm64 and x64. The Runtime Manager unpacks the matching, versioned engine into `~/.bob/runtimes/shared/latex/0.17.0` or `~/.bob/runtimes/shared/pandoc/3.11`. All conversations and compatible plugins reuse those files. No Homebrew, Python environment or plugin-private installation is involved.

The registry exposes `shared.latex` (`latex`), `shared.pandoc` (`pandoc`, `document.convert`) and `shared.pdf` (`pdf.preview`, PDF.js 6.3.289). Plugins declare required capabilities in `sharedCapabilities`. Platform code calls `resolve_platform_capability`; plugin code calls `resolve_capability`, which checks the declaration. The returned handle includes the executable and the shared Tectonic cache environment. Cache storage is included in Runtime Manager diagnostics.

Normal Bob sessions receive both binaries in PATH and the explicit `BOB_WORK_LATEX`/`BOB_WORK_PANDOC` environment variables. Prompt guidance explains native compilation and conversion and requests absolute output paths, which the conversation attaches automatically. Sandbox sessions retain their existing isolated execution policy.

Examples inside a Bob session:

```sh
tectonic -X compile --untrusted --outdir /path/to/workspace /path/to/workspace/report.tex
pandoc /path/to/workspace/report.md --standalone --pdf-engine=tectonic --output /path/to/workspace/report.pdf
pandoc /path/to/workspace/report.md --output /path/to/workspace/report.docx
```

Tectonic downloads required TeX support files on first use and reuses a single platform cache thereafter. Compilation can therefore require network access for new packages. It runs with `TECTONIC_UNTRUSTED_MODE=1`; shell escape is unavailable. Tectonic is an XeTeX-based engine, not a complete MacTeX distribution: packages requiring other external executables are not included. Pandoc supports PDF output through Tectonic; PDF is not a Pandoc input format.

`convert_document({ input: { sourcePath, outputPath } })` is the structured native API, exposed in TypeScript as `convertDocument(sourcePath, outputPath)`. It resolves shared handles, executes without a shell through Runtime Manager, enforces a 180-second timeout, stages output and publishes it only on success. The destination must be a new absolute path inside an existing directory; existing files are never overwritten. Supported outputs: PDF, DOCX, ODT, EPUB, HTML, Markdown, LaTeX, plain text and RTF. Source `.tex` to PDF uses Tectonic directly.

The same PDF.js component is used in assistant resource cards and the workspace panel. It loads visible documents lazily through the existing native preview bridge, displays one page at a time, supports zoom and selectable text, and destroys loading/render tasks on navigation or unmount. Workers, fonts, CMaps and WASM assets are bundled locally; no CDN is used. It is a reader, not a PDF editor or form-filling application.

## Rebuilding and validation

- `python3 apps/macos/scripts/build-document-runtimes.py` rebuilds the engine archives from official release URLs and SHA-256 digests pinned in `sources.json`. The upstream licenses are retained alongside the bundles and installed engines.
- `pnpm --dir apps/macos build` stages PDF.js support files and bundles its worker automatically. `pnpm --dir apps/macos dev` stages the same support files for development.
- `cargo test --manifest-path apps/macos/src-tauri/Cargo.toml document_runtimes_are_shared --lib` checks shared resolution, declaration enforcement and a real Pandoc conversion to DOCX, including paths containing spaces.
- `pnpm --dir apps/macos test src/components/PdfViewer/PdfViewer.test.tsx src/views/ChatView.message.test.tsx src/lib/localFilePaths.test.ts` exercises preview lifecycle and conversation integration.
- With Vite running, `/e2e/pdf-viewer-smoke.html` renders a real two-page Tectonic-generated PDF through the production component and worker. Only the native file bridge is mocked. This fixture is not included in the production Vite entrypoints.

Upstream: https://tectonic-typesetting.github.io/book/latest/ · https://pandoc.org/MANUAL.html · https://mozilla.github.io/pdf.js/
