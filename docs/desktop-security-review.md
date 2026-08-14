# Desktop security review

Review date: 2026-08-14. Scope: macOS release configuration, Tauri capabilities, embedded web preview, external navigation, WebDriver and Apple Events.

## Hardened runtime and entitlements

The release keeps only the runtime exception needed by JavaScriptCore (`com.apple.security.cs.allow-jit`). Bob Work does not load third-party native libraries and does not create arbitrary unsigned executable memory, so `allow-unsigned-executable-memory` and `disable-library-validation` were removed. File access remains user-selected, outbound network access is required for OAuth/API integrations, and Apple Events are required only when the user activates Chrome control.

## Web and shell boundaries

- The main WebView CSP does not allow remote scripts. Images and explicitly opened preview frames may use HTTPS.
- Embedded remote pages remain in their own origin and do not receive a Bob Work/Tauri capability.
- Browser input is normalized to `https://` unless the user explicitly enters `http://` or `https://`; other schemes cannot be loaded by the embedded preview.
- External navigation uses Tauri's narrow `shell:allow-open` capability. Command execution is not granted to the WebView.
- Sites that deny framing are opened in the system browser; Bob Work does not bypass `X-Frame-Options` or the site's CSP.

## E2E isolation

The WDIO crates are optional Cargo dependencies enabled only by the `e2e` feature. Their capabilities were removed from the production capability file. CI rejects a normal dependency graph containing `tauri-plugin-wdio` and also checks release symbols.

## macOS privacy prompts

- Notifications are requested when the user enables notifications or explicitly tests them.
- Microphone and speech recognition are requested only when the microphone button starts dictation.
- Accessibility is requested when Computer Use is enabled or tested.
- Automation is exercised when Chrome control is enabled/tested; macOS creates the Bob Work → Google Chrome row only after Bob Work actually sends an Apple Event. Bob Work cannot grant itself these permissions.

## Residual risks and tests

- Arbitrary HTTPS preview content is intentionally supported. Navigation tests must continue to cover hostile schemes and framing failures.
- Apple Events can control Chrome after explicit TCC consent. The UI must keep this capability disabled by default and clearly identify the target application.
- Release QA must inspect final entitlements with `codesign -d --entitlements :-`, verify notarization with `stapler validate`, and enforce Gatekeeper acceptance with `spctl --assess`.
