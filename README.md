# Bob Work

Bob Work regroupe dans un seul dépôt l’application desktop macOS et son client mobile. Le dossier qui contient le clone n’est pas un niveau supplémentaire du dépôt : `BobDesktop/`, `BobMobile/` et ce README sont directement versionnés.

## Organisation du dépôt

```text
racine Git
├── BobDesktop/              application macOS, backend local et runtimes
│   ├── apps/macos/          frontend React + shell Tauri/Rust
│   ├── packages/            types et composants partagés du desktop
│   ├── docs/                architecture, sécurité et exploitation
│   └── README.md            guide complet du desktop
├── BobMobile/               client Expo iOS/Android
│   ├── src/                 écrans, API distante et état applicatif
│   ├── assets/              ressources graphiques
│   └── README.md            guide complet du mobile
├── .github/workflows/       vérification, release et smoke tests
└── README.md                vue d’ensemble du produit
```

Les deux projets conservent leurs gestionnaires de dépendances propres : **pnpm** pour BobDesktop et **npm** pour BobMobile. Ils ne forment pas un workspace Node unique.

## Architecture produit

```text
┌──────────────────── BobMobile ────────────────────┐
│ React Native / Expo                               │
│ conversations · projets · fichiers · réglages     │
│ localisation opt-in · notifications · SSE         │
└───────────────────────┬───────────────────────────┘
                        │ HTTPS authentifié
                        │ REST + Server-Sent Events
                        ▼
┌──────────────────── BobDesktop ───────────────────┐
│ React / TypeScript / Vite                         │
│ chat · previews · plugins · intégrations          │
├───────────────────────┬───────────────────────────┤
│ IPC Tauri             │ API mobile / MCP gateway │
├───────────────────────▼───────────────────────────┤
│ Backend Rust                                      │
│ services · permissions · scheduler · SQLite       │
│ coffre local · artefacts · gestion des runtimes   │
└───────────┬───────────────────────┬───────────────┘
            │ bob run              │ stdio / HTTP
            ▼                      ▼
┌────────────────────┐   ┌─────────────────────────┐
│ IBM Bob Shell      │   │ MCP · APIs · SSH        │
│ agent · modes      │   │ outils spécialisés      │
│ skills · sessions  │   │ systèmes distants       │
└────────────────────┘   └─────────────────────────┘
```

BobDesktop est la source de vérité. Il exécute Bob Shell, conserve l’historique SQLite, applique les autorisations et gère les ressources locales. BobMobile est un client distant : il ne duplique pas la base de conversations et utilise l’API authentifiée exposée par le Mac.

## Architecture des runtimes

Un plugin décrit une capacité fonctionnelle ; un runtime fournit les exécutables et bibliothèques nécessaires à cette capacité. Les deux notions restent séparées.

```text
                         demande utilisateur
                                │
                                ▼
                     plugin / outil sélectionné
                                │
                       résolution de capacité
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
      runtime partagé    runtime externe     runtime privé
      livré/réutilisé    optionnel géré      embarqué par un
      par Bob Work       par Bob Work        plugin personnel
              │                 │                 │
              └─────────────────┴─────────────────┘
                                │
                     processus contrôlé local
                    timeout · environnement · logs
```

| Classe | Exemple | Cycle de vie |
|---|---|---|
| Partagé | visualisation, diagrammes, artefacts, Python compatible | Mutualisé entre plusieurs fonctionnalités ; non supprimé lorsqu’il appartient au cœur de l’application |
| Externe géré | Qiskit ou CodeGraph isolé | Proposé uniquement lorsqu’une tâche le nécessite ; installation, contrôle d’intégrité et suppression lorsque la stratégie est supportée |
| Privé de plugin | dépendance explicitement embarquée par l’auteur d’un plugin personnel | Déployé avec ce plugin et isolé de la plateforme partagée |

Les dépendances externes non gérables automatiquement restent détectées et documentées ; Bob Work demande alors une installation manuelle au lieu de prendre silencieusement possession d’un runtime système.

## Démarrage rapide

### BobDesktop

```bash
cd BobDesktop
pnpm install
pnpm dev
```

Prérequis principaux : macOS 12+, Node.js 22, pnpm 10, Rust stable et IBM Bob Shell disponible sur le `PATH`.

### BobMobile

```bash
cd BobMobile
npm install
npm start
```

Ouvrez ensuite Bob Work sur le Mac, activez **Réglages → Télécommande**, puis utilisez le lien sécurisé dans BobMobile.

## Commandes de validation

```bash
# Desktop
cd BobDesktop
pnpm mac:verify
pnpm mac:test:rust

# Mobile
cd ../BobMobile
npm run typecheck
npm run test:i18n
npm run test:visualization
npm run test:maps
```

## Documentation détaillée

- [Architecture et développement de BobDesktop](BobDesktop/README.md)
- [Architecture et développement de BobMobile](BobMobile/README.md)
- [Documents techniques du desktop](BobDesktop/docs/)

## Sécurité en bref

- secrets conservés côté Mac dans le coffre local ;
- API mobile protégée par un jeton et révocable avec la télécommande ;
- autorisations sensibles soumises aux politiques de Bob Work ;
- sandbox locale disponible pour limiter l’accès au disque ;
- position actuelle désactivée par défaut et utilisée seulement après consentement explicite ;
- aucun secret ni fichier `.env` ne doit être commité.

## Contribution

Travaillez dans le dossier du projet concerné, exécutez ses tests puis mettez à jour son README si l’architecture, les commandes ou le cycle de vie des runtimes évoluent. Les workflows GitHub à la racine valident et publient actuellement BobDesktop.
