# Bob Work — application macOS

Application desktop Tauri 2 + React 19 livrée dans ce monorepo.

Pour l’installation, l’architecture, les tests et les autres plateformes, voir le [README racine](../../README.md).

## Commandes locales

```bash
pnpm install                 # depuis la racine du monorepo
pnpm dev:tauri               # développement
pnpm ensure:dev-app          # bundle .app debug (notifications TCC)
pnpm build:tauri             # build production
pnpm test                    # Vitest
pnpm test:e2e                # WebdriverIO
pnpm smoke:bob               # smoke Bob Shell réel
pnpm verify                  # typecheck + unit + vite build
```

Backend Rust : `src-tauri/` (`cargo test --manifest-path src-tauri/Cargo.toml`).
