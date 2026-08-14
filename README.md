# Bob Work

**Version :** 0.1.4  
**Statut :** application desktop locale fonctionnelle (macOS)  
**Dernière mise à jour :** 2026-08-11

Bob Work est une application native qui rend les capacités d’**IBM Bob** accessibles sans manipuler la CLI. Elle s’appuie sur **Bob Shell 2** comme moteur agentique local : conversations, projets, tâches, planifications, plugins, skills, MCP, intégrations et artefacts.

> Transformer une conversation en projet, livrable, automatisation ou plugin privé — avec Bob Shell comme moteur d’exécution local.

---

## Sommaire

1. [Plateformes](#plateformes)
2. [Prérequis](#prérequis)
3. [Installation](#installation)
4. [Démarrage rapide](#démarrage-rapide)
5. [Architecture](#architecture)
6. [Composants et fonctionnalités](#composants-et-fonctionnalités)
7. [Stack technique](#stack-technique)
8. [Structure du dépôt](#structure-du-dépôt)
9. [Configuration](#configuration)
10. [Tests](#tests)
11. [CI / CD](#ci--cd)
12. [Sécurité](#sécurité)
13. [Documentation](#documentation)
14. [Limites connues](#limites-connues)
15. [Licence](#licence)

---

## Plateformes

| Plateforme | Application Bob Work | Bob Shell (moteur) | Notes |
|------------|----------------------|--------------------|--------|
| **macOS 12+** (Apple Silicon) | ✅ Livrée (`apps/macos`, DMG `aarch64`) | ✅ Requis | Cible principale ; tray, notifications UN, Quick Look, TCC |
| **macOS Intel** | ⚠️ Possible | ✅ Requis | Build `x86_64` / universel non livré par défaut |
| **Linux** | ❌ Non livrée | ✅ Installable (voir script / IBM) | Pas d’app Tauri Linux dans ce dépôt |
| **Windows** | ❌ Non livrée | ✅ Installable (selon offre IBM) | Pas d’app Tauri Windows dans ce dépôt |

Le monorepo ne contient aujourd’hui que l’application **macOS**. Les sections Linux / Windows ci-dessous couvrent l’installation de **Bob Shell** et les prérequis pour un futur portage desktop ; elles ne décrivent pas une app Bob Work packagée.

---

## Prérequis

### Communs (développement)

| Outil | Version recommandée |
|-------|---------------------|
| **Node.js** | 22.15+ |
| **pnpm** | 10.11+ (CI utilise pnpm 10.11) |
| **Rust** | stable (1.70+), avec `cargo` |
| **Git** | 2.x |
| **Bob Shell** | 2.x (`bob` sur le `PATH`) |

### macOS (application)

- macOS 12 (Monterey) ou plus récent  
- Xcode Command Line Tools (`xcode-select --install`)  
- Pour les bannières Notifications en développement : un vrai `.app` (voir `ensure:dev-app`), pas seulement le binaire `tauri dev`  
- Permissions Système selon les fonctions : Notifications, Accessibilité, Automatisation, Microphone / Reconnaissance vocale  

### Linux (Bob Shell uniquement)

- Distribution récente (glibc)  
- `curl` / `bash` pour le script d’installation IBM si disponible  
- Node ou le gestionnaire de paquets demandé par le script Bob Shell  
- Pas de build Tauri Bob Work dans ce dépôt  

### Windows (Bob Shell uniquement)

- Windows 10/11 64 bits  
- PowerShell / terminal avec `bob` sur le `PATH` après installation IBM  
- Visual Studio Build Tools uniquement si vous portez un jour le backend Rust/Tauri  
- Pas de build Tauri Bob Work dans ce dépôt  

---

## Installation

### 1. Cloner le dépôt

```bash
git clone <url-du-depot>
cd BOBWork
```

### 2. Installer Bob Shell 2

Vérifiez d’abord si Bob est déjà présent :

```bash
which bob
bob --version   # attendu : 2.x
bob run --help
```

Sinon, utilisez le script fourni (selon votre offre IBM / COS) :

```bash
# Exemple — suivez les options du script
./bobshell-install.sh --help
./bobshell-install.sh --package-manager pnpm
```

Sur **Linux** et **Windows**, installez Bob Shell via le canal IBM / script adapté à votre OS, puis assurez-vous que `bob` est disponible dans le shell.

Authentification headless utilisée par Bob Work : clé API injectée dans `bob run` (`BOB_API_KEY` / `BOBSHELL_API_KEY`). Le login interactif `bob chat` n’est pas le chemin principal de l’app.

### 3. Dépendances du monorepo

```bash
pnpm install
```

### 4. Variables d’environnement (optionnel)

```bash
cp apps/macos/.env.example apps/macos/.env
# Renseigner les Client ID OAuth (GitHub, Slack, Monday, Microsoft) si besoin
```

Voir [Configuration](#configuration).

---

## Démarrage rapide

### macOS — développement

```bash
# Depuis la racine du monorepo
pnpm dev
# équivalent : pnpm mac:dev  →  tauri dev
```

Pour les **notifications macOS** (enregistrement TCC sous Réglages → Notifications) :

```bash
pnpm --filter macos run ensure:dev-app
# ou installation dans /Applications
pnpm --filter macos run install:dev-app
open -n "apps/macos/src-tauri/target/debug/bundle/macos/Bob Work.app"
```

### macOS — build production / DMG

```bash
pnpm mac:build          # tauri build
pnpm mac:dmg            # bundle DMG
```

Le build local reste signé **ad hoc**. La publication GitHub automatisée signe avec Developer ID, notarie chez Apple et génère les artefacts de mise à jour signés. Configuration : [docs/release-macos.md](docs/release-macos.md).

### Linux / Windows — développement applicatif

Il n’existe pas encore de cible `apps/linux` ni `apps/windows`. Pour contribuer au moteur commun :

1. Installer Node 22, pnpm, Rust.  
2. Exécuter les packages partagés et les tests TypeScript non liés à Tauri macOS :
   ```bash
   pnpm install
   pnpm --filter @bob-work/shared-types exec tsc --noEmit   # si scripts exposés
   ```
3. Les commandes `pnpm mac:*` et `tauri` **nécessitent macOS**.  

Le portage desktop (Tauri multi-OS) réutiliserait `packages/*`, une grande partie des services Rust, et remplacerait les modules macOS-only (UNUserNotificationCenter, Quick Look, AppleScript, LaunchAgent).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Bob Work (UI desktop)                     │
│  React 19 · TypeScript · Vite · Zustand · Tailwind · i18n    │
├──────────────────────────────────────────────────────────────┤
│                         IPC Tauri 2                           │
├──────────────────────────────────────────────────────────────┤
│  Backend Rust (Tauri)                                         │
│  commands → services → SQLite · coffre AES · FS · spawn bob   │
└────────────────────────────┬─────────────────────────────────┘
                             │ bob run (stream-json)
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                     IBM Bob Shell 2                           │
│  modes · skills · MCP · outils · reprise de tâche             │
└──────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
   ~/.bob/skills/ …              Serveurs MCP / APIs
```

### Flux principal

1. L’utilisateur envoie un message (mode, projet, pièces jointes).  
2. Le frontend appelle une commande Tauri (`send_message`, etc.).  
3. Le service `bob` prépare le prompt, les permissions, les MCP/intégrations, puis lance `bob run`.  
4. Les événements structurés (texte, outils, erreurs, résultat) sont streamés vers l’UI.  
5. À la fin : persistance SQLite, artefacts, notifications (succès / erreur), sync plugins agentiques éventuels.

### Couches

| Couche | Rôle |
|--------|------|
| **Views / composants React** | Chat, Plugins, Skills, Intégrations, Tâches, Planning, Artefacts, Réglages, Onboarding |
| **IPC (`lib/ipc.ts`)** | API typée vers les commandes Rust |
| **Commands** | Frontière Tauri (`commands/*`) |
| **Services** | Bob, plugins, MCP, OAuth, scheduler, notify, vault, audit, workspace… |
| **Stockage** | SQLite (`app_data_dir/database.sqlite`), coffre AES-256-GCM, `~/.bob/` pour skills / MCP Bob |

Identifiant d’app : `com.bobwork.desktop` (dossier de données Tauri).

---

## Composants et fonctionnalités

| Domaine | Description |
|---------|-------------|
| **Chat** | Streaming, file de prompts, modes, pièces jointes, activité agentique, sources |
| **Projets** | Espaces de travail, instructions, intégrations autorisées |
| **Tâches** | Historique d’exécution, reprise, états, I/O |
| **Planning** | Cron / récurrences, politiques catch-up & chevauchement, tray quand la fenêtre est fermée |
| **Plugins** | Bundles agentiques (manifest, scripts, MCP, hooks, versions SemVer, rollback) |
| **Skills** | `SKILL.md` personnels / intégrés ; création manuelle, avec Bob, ou import Claude OSS |
| **Intégrations & MCP** | GitHub, Slack, Monday, Microsoft (catalogue) ; APIs publiques / à clé ; serveurs MCP ; tests de connexion |
| **Computer Use / Chrome** | Plugins / MCP locaux ; Accessibilité & Automatisation macOS |
| **Approbations** | Overlay + gouvernance des permissions ; pas de YOLO silencieux |
| **Artefacts** | Galerie, prévisualisation panneau droit, Quick Look / ouverture native |
| **Notifications** | Feed in-app + bannières macOS (fin de tâche, **erreurs Bob Shell**, approbations) |
| **i18n** | Français, anglais, espagnol (`auto` = langue système) |

Plugins intégrés notables : Documents / Office (Word, Excel, PowerPoint, OneNote), Chrome, Computer Use, CTO Investissements, etc.

---

## Stack technique

### Frontend (`apps/macos/src`)

| Technologie | Usage |
|-------------|--------|
| **React 19** | UI |
| **TypeScript ~5.8** | Typage |
| **Vite 7** | Bundler / dev server |
| **Zustand** | État global |
| **React Router 6** | Navigation |
| **Tailwind CSS 3** + CSS custom | Styles |
| **Framer Motion** | Animations |
| **Lucide React** | Icônes |
| **react-markdown** + GFM | Rendu Markdown |
| **@tauri-apps/api** + plugins | Dialog, FS, notification, shell, opener, os, process |
| **Vitest** + Testing Library | Tests unitaires UI |

### Backend (`apps/macos/src-tauri`)

| Technologie | Usage |
|-------------|--------|
| **Tauri 2** | Shell natif, IPC, fenêtres, tray |
| **Rust (édition 2021)** | Services métier |
| **tokio** | Async, process Bob |
| **rusqlite** | Persistance |
| **serde / serde_json** | Sérialisation |
| **aes-gcm** | Coffre local des secrets |
| **reqwest** | HTTP (OAuth, probes) |
| **cron** | Planificateur |
| **objc2 / UserNotifications** | Notifications macOS (cible `macos`) |

### Packages partagés

| Package | Rôle |
|---------|------|
| `@bob-work/shared-types` | Types TS partagés (plugins, settings, MCP…) |
| `@bob-work/bob-adapter` | Adaptateur / helpers Bob |
| `@bob-work/ui` | Composants UI partagés |

### Outils

- **pnpm** workspaces  
- **ESLint** (frontend)  
- **GitHub Actions** (verify + smoke Bob Shell)  
- **WebdriverIO** (e2e macOS)  

---

## Structure du dépôt

```
BOBWork/
├── apps/
│   └── macos/                      # Application Tauri (seule app livrée)
│       ├── src/                    # Frontend React
│       │   ├── components/
│       │   ├── views/
│       │   ├── stores/
│       │   ├── lib/                # ipc, i18n helpers, catalogues
│       │   └── i18n/
│       ├── src-tauri/
│       │   ├── src/
│       │   │   ├── commands/
│       │   │   ├── services/       # bob, plugin, notify, oauth, …
│       │   │   ├── models/
│       │   │   ├── security/
│       │   │   └── …
│       │   └── resources/          # MCP Python, OAuth manifests, finance…
│       ├── e2e/                    # Specs WDIO + fixtures (fake-bob)
│       ├── scripts/                # ensure-dev-app, smoke-bob-shell, …
│       └── package.json
├── packages/
│   ├── bob-adapter/
│   ├── shared-types/
│   └── ui/
├── docs/                           # Specs, sécurité, limites, plans
├── .github/workflows/
│   ├── verify.yml
│   └── smoke-bob-shell.yml
├── bobshell-install.sh
├── package.json                    # Scripts monorepo
├── pnpm-workspace.yaml
└── README.md
```

---

## Configuration

### Fichier `apps/macos/.env`

Copier depuis `.env.example`. Principales variables :

| Variable | Rôle |
|----------|------|
| `BOBWORK_OAUTH_GITHUB_CLIENT_ID` / `_SECRET` | OAuth GitHub |
| `BOBWORK_OAUTH_SLACK_CLIENT_ID` | Slack PKCE |
| `BOBWORK_OAUTH_MONDAY_CLIENT_ID` | Monday (optionnel) |
| `BOBWORK_OAUTH_MICROSOFT_CLIENT_ID` | Microsoft 365 PKCE |
| `FINNHUB_API_KEY` | Enrichissement plugin CTO (optionnel) |
| `TMDB_API_KEY` | Tests e2e APIs (optionnel) |

Redirect OAuth local : `http://127.0.0.1:47823/oauth/callback`.

Manifests d’enregistrement : `apps/macos/src-tauri/resources/oauth/`.

### Données runtime

| Emplacement | Contenu |
|-------------|---------|
| Dossier données Tauri (`com.bobwork.desktop`) | SQLite, coffre chiffré, caches / aperçus |
| `~/.bob/skills/` | Skills & bundles plugins déployés |
| `~/.bob/settings/` | MCP / réglages Bob Shell |

---

## Tests

### Scripts monorepo (racine)

| Commande | Description |
|----------|-------------|
| `pnpm mac:test:ts` | Tests unitaires frontend (Vitest) |
| `pnpm mac:test:rust` | Tests unitaires Rust (`cargo test`) |
| `pnpm mac:test` | TS + Rust |
| `pnpm mac:verify` | `tsc` + Vitest + build Vite |
| `pnpm mac:test:e2e` | Prépare fixtures, build `e2e`, lance WebdriverIO |
| `pnpm mac:test:live-bob-oauth` | Parcours OAuth live (expect) |
| `pnpm mac:smoke:bob` | Smoke contre un vrai Bob Shell (`BOB_API_KEY`) |
| `pnpm mac:ci` | verify + cargo test + cargo build release |

### Tests unitaires — frontend

```bash
pnpm --filter macos test
# ou
pnpm mac:test:ts
```

- Framework : **Vitest**  
- UI : **Testing Library**  
- Emplacement : `apps/macos/src/**/*.test.ts(x)`  
- Couvre vues (Plugins, Intégrations, Chat, …), composants, i18n, catalogues builtins  

### Tests unitaires — Rust

```bash
pnpm mac:test:rust
# ou
cargo test --manifest-path apps/macos/src-tauri/Cargo.toml
```

- Emplacement : `apps/macos/src-tauri/src/**` (`#[cfg(test)]`, `tests.rs`)  
- Couvre services Bob, plugins, sécurité, notifications, workspace, etc.  
- Les features `e2e` ne doivent **pas** être activées dans le binaire release CI  

### Tests end-to-end (macOS)

```bash
pnpm mac:test:e2e
```

- Framework : **WebdriverIO** (`wdio.conf.ts`)  
- Build dédié avec feature Cargo `e2e` + `VITE_BOB_WORK_E2E=1`  
- Fixture CLI : `apps/macos/e2e/fixtures/fake-bob` (pas de réseau IBM en CI e2e locale)  
- Specs : `apps/macos/e2e/specs/*.e2e.ts` (app, plugins, intégrations, computer-use, connection-tests…)  
- Le job GitHub Actions `e2e-macos` exécute cette même suite sur l’application empaquetée et conserve les preuves 14 jours.

### Smoke Bob Shell réel

```bash
export BOB_API_KEY=…
pnpm mac:smoke:bob
```

---

## CI / CD

| Workflow | Déclencheur | Contenu |
|----------|-------------|---------|
| [`.github/workflows/verify.yml`](.github/workflows/verify.yml) | push / PR | macOS : pnpm verify, `cargo test`, build release **sans** feature `e2e`, contrôle d’absence de symboles e2e |
| [`.github/workflows/smoke-bob-shell.yml`](.github/workflows/smoke-bob-shell.yml) | tag / manuel | Install Bob Shell + smoke (`BOB_API_KEY` secret) |

Runner principal : **`macos-latest`**.

---

## Sécurité

Principes détaillés dans [docs/security-model.md](docs/security-model.md) et [docs/keychain-security.md](docs/keychain-security.md) :

- **Coffre local AES-256-GCM** pour la clé API Bob et les secrets d’intégration (pas de Trousseau macOS)  
- Injection des secrets uniquement dans le processus enfant `bob run`  
- Redaction des secrets dans les logs / flux  
- Validation de chemins, refus de secrets littéraux dans les manifestes MCP  
- Hooks plugins avec environnement minimal (sans jetons Bob / intégrations)  
- Approbations pour les actions sensibles ; politique de permissions persistée  
- OAuth réel uniquement — jamais d’état « connecté » simulé  

---

## Documentation

| Document | Contenu |
|----------|---------|
| [docs/executive-summary.md](docs/executive-summary.md) | Synthèse produit |
| [docs/product-requirements.md](docs/product-requirements.md) | Exigences & user stories |
| [docs/system-design.md](docs/system-design.md) | Conception système |
| [docs/implementation-plan-shell-2.md](docs/implementation-plan-shell-2.md) | Plan d’implémentation Shell 2 |
| [docs/bob-capability-matrix.md](docs/bob-capability-matrix.md) | Matrice capacités Bob |
| [docs/security-model.md](docs/security-model.md) | Modèle de menace & contrôles |
| [docs/keychain-security.md](docs/keychain-security.md) | Coffre local (pas Keychain) |
| [docs/ui-specification.md](docs/ui-specification.md) | Spec UI |
| [docs/delivery-plan.md](docs/delivery-plan.md) | Plan de livraison |
| [docs/limitations.md](docs/limitations.md) | **Limites et garanties 0.1.4** |
| [docs/auth-troubleshooting.md](docs/auth-troubleshooting.md) | Dépannage auth |
| [docs/release-macos.md](docs/release-macos.md) | Signature, notarisation et mises à jour |
| [docs/test-report.md](docs/test-report.md) | Rapport de tests |
| [docs/bob-validation-checklist.md](docs/bob-validation-checklist.md) | Checklist de validation |

---

## Limites connues

Résumé — détail dans [docs/limitations.md](docs/limitations.md) :

- Application desktop **macOS only** (Apple Silicon DMG)  
- Builds locaux ad hoc ; releases GitHub signées/notariées lorsque les secrets Apple du dépôt sont configurés  
- Accès Web / Computer Use / Chrome dépendent de Bob Shell + permissions macOS  
- Fermer la fenêtre ≠ quitter : le tray maintient le scheduler ; Quitter arrête le moteur  
- Linux / Windows : pas d’app packagée dans ce dépôt  

---

## Scripts utiles (racine)

```bash
pnpm dev                 # Dev Tauri macOS
pnpm build               # Build Tauri
pnpm mac:test            # Unitaires TS + Rust
pnpm mac:verify          # typecheck + unit + vite build
pnpm mac:test:e2e        # E2E WebdriverIO
pnpm mac:smoke:bob       # Smoke Bob Shell réel
pnpm lint                # Lint récursif
pnpm typecheck           # Typecheck récursif
```

---

## Licence

À définir. Prototype / intégration IBM Bob — usage selon les conditions de votre organisation et d’IBM Bob Shell.

---

## Remerciements

- Équipe IBM Bob / Bob Shell  
- Projet [Tauri](https://tauri.app/)  
- Communauté open source (React, Rust, Vitest, WebdriverIO, …)

---

## Historique du document

| Version | Date | Changements |
|---------|------|-------------|
| 0.1.0 | 2026-08-05 | README initial |
| 0.1.4 | 2026-08-11 | Refonte : plateformes, install, architecture réelle, stack, tests unitaires / e2e, CI |
