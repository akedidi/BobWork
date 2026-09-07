# Bob Work macOS application

Tauri 2 and React 19 desktop application shipped as part of the BobDesktop workspace.

For installation, architecture, testing, security, and platform support, see the [BobDesktop README](../../README.md).

## Local commands

Run these commands from `BobDesktop/`:

```bash
pnpm install                 # install workspace dependencies
pnpm dev                     # start Tauri development mode
pnpm mac:release             # clean, build, and certify the Release app
pnpm mac:dmg                 # clean, build, and certify the Release DMG
pnpm mac:test:ts             # frontend unit tests
pnpm mac:test:rust           # Rust unit tests
pnpm mac:test:e2e            # WebdriverIO end-to-end suite
pnpm mac:smoke:bob           # smoke test against a real Bob Shell
pnpm mac:verify              # typecheck, unit tests, and Vite build
pnpm mac:cache:guard         # invalidate stale Rust artifacts when inputs change
pnpm mac:cache:trim          # trim the Rust cache only after its size threshold
```

The Rust backend lives in `src-tauri/` and can also be tested directly:

```bash
cargo test --manifest-path apps/macos/src-tauri/Cargo.toml
```

The cache threshold can be overridden for one run, for example:

```bash
BOB_WORK_CACHE_MAX_GIB=6 pnpm mac:cache:trim
```

Threshold-based trimming preserves incremental compilation while the cache remains reasonable. Release commands use the stricter clean-build and bundle-certification pipeline documented in the main README.
