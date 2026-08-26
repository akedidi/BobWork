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
pnpm trim:rust               # nettoie le cache Rust seulement à partir de 8 Gio
pnpm trim:rust:force         # nettoie immédiatement le cache Rust
```

Backend Rust : `src-tauri/` (`cargo test --manifest-path src-tauri/Cargo.toml`).

Le seuil de nettoyage peut être ajusté ponctuellement, par exemple avec
`BOB_WORK_CACHE_MAX_GIB=6 pnpm trim:rust`. Cette routine reste volontairement
conditionnelle afin de conserver les compilations incrémentales tant que le
cache reste raisonnable.
