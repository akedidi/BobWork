# Build cache policy

Bob Work keeps dependency downloads but treats compiled output as disposable.

- Git ignores `node_modules`, coverage reports, Vite output and every Tauri `target` directory.
- GitHub Actions caches the normal Rust target and the E2E target under distinct keys.
- When free disk space drops below 20 GiB, run `cargo clean --manifest-path apps/macos/src-tauri/Cargo.toml` before a full packaged-app or E2E build.
- Do not delete source files, SQLite user data, signing keys or the pnpm content-addressed store as part of routine cleanup.
- CI evidence is uploaded with a 14-day retention period to prevent unbounded artifact growth.

On 2026-08-14, the local Rust cache cleanup removed 7.4 GiB and raised available disk space from 14 GiB to 21 GiB.
