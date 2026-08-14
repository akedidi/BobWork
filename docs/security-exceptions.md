# Security exceptions

## CVE-2026-56876 / GHSA-jmr9-qjv8-65gv — `extract-zip` 2.0.1

- **Status:** temporarily accepted; no patched upstream release exists as of 2026-08-14.
- **Dependency path:** `@wdio/cli` → `@wdio/utils` → `@puppeteer/browsers` → `extract-zip`.
- **Production exposure:** none. This dependency is development-only, is not bundled in Bob Work, and is used only while preparing the packaged-app E2E runner.
- **Threat model:** the vulnerable API can follow an unvalidated symlink while extracting a hostile archive. Bob Work never passes user-provided archives to this package. E2E downloads run in an ephemeral GitHub runner or on a developer machine over HTTPS from the browser provider.
- **Compensating controls:** E2E runs without production credentials; CI runners are ephemeral; artifacts are not reused as application inputs; the exception is limited to this CVE and all other high/critical advisories fail CI.
- **Owner:** release engineering.
- **Review deadline:** 2026-09-30, or immediately when WDIO/Puppeteer publishes a dependency containing a patched `extract-zip`.
- **Removal criterion:** upgrade the WDIO/Puppeteer chain, remove `--ignore CVE-2026-56876`, and require a completely clean high/critical audit.

The CI invokes `pnpm audit --audit-level=high --ignore CVE-2026-56876`. The exception is explicit rather than using `--ignore-unfixable`, so a new unpatched vulnerability still fails the build.
