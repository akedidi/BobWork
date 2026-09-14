# Bob Work macOS application

Tauri 2 and React 19 desktop application shipped as part of the BobDesktop workspace.

For installation, architecture, testing, security, and platform support, see the [BobDesktop README](../../README.md).

## Local commands

Run these commands from `BobDesktop/`:

```bash
pnpm install                 # install workspace dependencies
pnpm dev                     # start Tauri development mode
pnpm mac:release             # clean, build, and certify the Release app
pnpm mac:install:test        # incremental Bob Work-test rebuild + install + launch
pnpm mac:release:test        # same pipeline for Bob Work-test + install to /Applications
pnpm mac:dmg                 # clean, build, and certify the Release DMG
pnpm mac:test:ts             # frontend unit tests
pnpm mac:test:rust           # Rust unit tests
pnpm mac:test:e2e            # WebdriverIO end-to-end suite
pnpm mac:smoke:bob           # smoke test against a real Bob Shell
pnpm mac:verify              # typecheck, unit tests, and Vite build
pnpm mac:cache:guard         # invalidate stale Rust artifacts when inputs change
pnpm mac:cache:trim          # trim the Rust cache only after its size threshold
```

Run these from `BobDesktop/` (workspace root). `pnpm mac:release` and `pnpm mac:release:test` always rebuild from clean Release inputs. Use `pnpm mac:install:test` for a faster incremental Bob Work-test install.

### Bob Work vs Bob Work-test

| Field | Bob Work | Bob Work-test |
|---|---|---|
| Command | `pnpm mac:release` | `pnpm mac:install:test` / `pnpm mac:release:test` |
| Product / window title | Bob Work | Bob Work-test |
| Bundle id | `com.bobwork.desktop` | `com.bobwork.desktop.test` |
| Executable | `Contents/MacOS/bob-work` | `Contents/MacOS/bob-work-test` |
| CFBundleName | Bob Work | Bob Work-test |
| Info.plist | `Info.plist` | `Info.test.plist` |
| Icons | `icons/` | `icons/test/` (amber **T** badge) |
| App data | `~/Library/Application Support/com.bobwork.desktop/` | `…/com.bobwork.desktop.test/` |
| Automation socket | `~/.bob/run/applescript.sock` | `~/.bob/run/applescript-test.sock` |

Identity constants live in `scripts/app-identity.sh`, `src-tauri/src/app_identity.rs`, `tauri.conf.json`, and `tauri.test.conf.json`. Never ship the same `Contents/MacOS` binary name for both apps — macOS Automation / TCC conflates them.

After `pnpm mac:release:test` or `pnpm mac:install:test`, launch the side-by-side build with:

```bash
pnpm --filter macos run open:test-app
```

Use Bob Work-test when you need a clean install scenario or to compare sessions against production Bob Work on the same machine.

`pnpm mac:release` selects a stable Apple Development signing identity when available and rejects an ad-hoc designated requirement during certification. Public distribution still uses Developer ID signing and Apple notarization through the release workflow.

The Rust backend lives in `src-tauri/` and can also be tested directly:

```bash
cargo test --manifest-path apps/macos/src-tauri/Cargo.toml
```

The cache threshold can be overridden for one run, for example:

```bash
BOB_WORK_CACHE_MAX_GIB=6 pnpm mac:cache:trim
```

Threshold-based trimming preserves incremental compilation while the cache remains reasonable. Release commands use the stricter clean-build and bundle-certification pipeline documented in the main README.

## Publishing a GitHub release (automatic updates)

Shipped builds poll `https://github.com/akedidi/BobWork/releases/latest/download/latest.json` (configured in `scripts/create-release-config.mjs`). The sidebar shows an update icon beside **Settings** only when that manifest advertises a newer signed version.

To publish when you want users to receive an update (not on every local build):

1. Bump `version` in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Commit and push, then create and push a tag: `git tag v0.1.9 && git push origin v0.1.9`.
3. The [Release macOS](https://github.com/akedidi/BobWork/actions/workflows/release.yml) workflow signs, notarizes, uploads the DMG, and publishes `latest.json` for the Tauri updater.

The updater replaces only the application bundle. User data under `~/Library/Application Support/com.bobwork.desktop/` (SQLite, settings, backups, plugins) is untouched.
