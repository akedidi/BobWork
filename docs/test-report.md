# Bob Work — rapport de validation

**Date :** 9 août 2026  
**Version :** 0.1.4  
**État :** toutes les suites exécutées sont passantes

## Résultat

| Suite | Tests | Réussis | Échecs |
|---|---:|---:|---:|
| Backend Rust | 63 | 63 | 0 |
| Interface TypeScript/Vitest | 44 | 44 | 0 |
| Parcours macOS bout en bout | 18 | 18 | 0 |
| **Total** | **125** | **125** | **0** |

La compilation TypeScript et le build Vite de production passent également. Le scénario bout en bout reconstruit l’application Tauri avec le backend local avant de piloter la WebView macOS.

## Couverture fonctionnelle vérifiée

- Configuration headless de `bob run` avec clé limitée à la session, sans coffre, sans Trousseau et sans faux login SSO.
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
- Clé Bob et jetons manuels d’intégration limités à la mémoire de session, sans persistance dans le Trousseau, SQLite ou un fichier.

## Commandes validées

- `cargo test` dans `apps/macos/src-tauri`
- `pnpm --filter macos run test`
- `pnpm --filter macos run build`
- `pnpm --filter macos run test:e2e`
