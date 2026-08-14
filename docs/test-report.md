# Bob Work — rapport de validation

**Date :** 14 août 2026  
**Version :** 0.1.4  
**État :** toutes les suites exécutées sont passantes

## Résultat

| Suite | Tests | Réussis | Échecs |
|---|---:|---:|---:|
| Backend Rust | 192 | 190 | 0 (2 ignorés) |
| Interface TypeScript/Vitest | 183 | 183 | 0 |
| Parcours macOS bout en bout | 97 | 97 | 0 |
| **Total exécuté** | **470** | **470** | **0** |

La compilation TypeScript et le build Vite de production passent également. Le scénario bout en bout reconstruit l’application Tauri avec le backend local avant de piloter la WebView macOS.

Couverture Vitest imposée dans la CI : 54,96 % des instructions, 50,81 % des branches, 42,33 % des fonctions et 59,19 % des lignes. Les modules critiques disposent de seuils renforcés. Le rapport HTML est conservé comme artefact CI pendant 14 jours.

L’audit des dépendances ne contient aucune vulnérabilité critique. L’unique alerte élevée restante concerne `extract-zip` dans la chaîne WebDriver de développement ; aucune version corrigée n’est publiée et l’exception bornée est décrite dans `docs/security-exceptions.md`. Les plugins WebDriver sont exclus du binaire de production.

## Couverture fonctionnelle vérifiée

- Configuration headless de `bob run` avec clé dans le **coffre local chiffré** (AES-256-GCM), sans Trousseau macOS et sans faux login SSO.
- Premier prompt visible immédiatement, titre généré une seule fois, conversations et tâches persistantes.
- Flux Bob Shell structuré avec analyse observable, outils, sources, fichiers, erreurs et fin de tâche.
- File FIFO de prompts, pièces jointes, modes Bob, projets, recherche et épinglage.
- Création, modification, activation et suppression de plugins et skills.
- Plugin agentique Cloud Architect réellement créé par un prompt avec :
  - skill Bob et CLI Python local ;
  - serveur MCP JSON-RPC initialisé et appelé ;
  - connecteur MCP obligatoire et intégration GitHub optionnelle ;
  - capacité navigateur déclarée et contrôlée par les réglages ;
  - hook local exécuté avant la tâche et visible dans l’activité ;
  - modèle de tâche planifiée prérempli et lié au plugin.
- Activation/désactivation MCP synchronisée avec le plugin.
- Versioning SemVer des plugins : détection sans écrasement, archive immuable du bundle Python/MCP, notes de version, comparaison des permissions, installation explicite et retour arrière complet de `1.3.0` vers `1.2.0`.
- Planifications, exécution immédiate, historique, pause et politiques locales.
- Catalogue Outlook, Teams, Outlook Calendar, OneDrive, GitHub, Slack et Monday.com sans écriture d’un secret réel pendant les tests.
- Réglages, permissions, limites, web, sous-agents, thème et langue.

## Contrôles de sécurité dédiés

- Refus d’un OAuth simulé : une intégration OAuth/MCP doit référencer un serveur MCP déclaré.
- Refus des secrets littéraux dans les en-têtes ou variables d’un manifeste MCP.
- Validation et canonicalisation des chemins des scripts, MCP et hooks.
- Hooks exécutés avec un environnement minimal, sans clé Bob ni jeton d’intégration.
- Blocage d’un plugin lorsque son MCP, sa connexion ou sa capacité navigateur obligatoire n’est pas prêt.
- Clé Bob et jetons manuels d’intégration dans le coffre local chiffré (pas de clair dans SQLite ; pas de Trousseau macOS).
- Redaction stdout/stderr + JSON stream-json (Bearer, `api_key`/`token`, Slack `xox*`, GitHub `ghp_`/`github_pat_`, `sk-`, PEM) avant émission UI.
- Préflight unattended des planifications (coffre + grant « Toujours » si politique restrictive). `never_ask` ne déclenche pas ce préflight ; distinct du démarrage interactif.
- IPC typé : `install_bob_shell`, `open_data_dir`, `export_diagnostics`, `create_permission_grant`.
- Sauvegarde SQLite via l’API online backup, contrôle d’intégrité, restauration avec copie de sécurité et rejet d’une base corrompue.
- Navigation du navigateur intégré limitée aux URL HTTP(S) ; schémas `javascript:`, `data:`, `file:` et hôtes invalides refusés.
- e2e `bail: 0` (la suite continue après un échec) et helpers partagés (`e2e/helpers.ts`).

## Commandes validées

- `cargo test` dans `apps/macos/src-tauri`
- `pnpm --filter macos run test`
- `pnpm --filter macos run build`
- `pnpm --filter macos run test:e2e`
