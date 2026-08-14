# Publication macOS de Bob Work

La publication est automatisée par `.github/workflows/release.yml`. Un tag `vX.Y.Z`
ou un lancement manuel construit l’application, la signe avec Developer ID, la
notarie chez Apple, publie le DMG et génère `latest.json` avec les artefacts signés
du programme de mise à jour.

## Configuration unique du dépôt GitHub

Secrets Actions :

- `APPLE_CERTIFICATE` : certificat Developer ID Application `.p12` encodé en base64.
- `APPLE_CERTIFICATE_PASSWORD` et `KEYCHAIN_PASSWORD`.
- `APPLE_ID`, `APPLE_PASSWORD` (mot de passe spécifique à l’app) et `APPLE_TEAM_ID`.
- `TAURI_SIGNING_PRIVATE_KEY` et, si nécessaire, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Variables Actions :

- `TAURI_UPDATER_PUBLIC_KEY` : clé publique correspondant à la clé privée Tauri.
- `BOBWORK_OAUTH_MICROSOFT_CLIENT_ID` : identifiant UUID de l’application publique Entra.

Générer une seule fois les clés de mise à jour avec `pnpm tauri signer generate -w
~/.tauri/bob-work.key`. La clé privée ne doit jamais être commitée. La clé publique
peut être enregistrée dans la variable GitHub ci-dessus.

## Contrôles avant tag

1. Aligner la version dans `apps/macos/package.json`, `src-tauri/Cargo.toml` et
   `src-tauri/tauri.conf.json`.
2. Exécuter les contrôles unitaires et E2E.
3. Créer et pousser le tag correspondant, par exemple `v0.1.5`.
4. Après publication, vérifier le DMG, la notarisation (`spctl`) et l’URL
   `https://github.com/akedidi/BobWork/releases/latest/download/latest.json`.

Le workflow effectue désormais ces contrôles lui-même après publication : signature Developer ID profonde et stricte, acceptation Gatekeeper, ticket de notarisation agrafé sur l’app et le DMG, version et schéma de `latest.json`, correspondance des signatures updater et empreintes SHA-256. Les preuves sont conservées 90 jours dans l’artefact `bob-work-release-certification-*`.

## Test updater N → N+1

Le workflow manuel `.github/workflows/updater-smoke.yml` installe le DMG d’une version N dans un dossier isolé, puis vérifie avec le vrai updater Tauri :

1. la détection de N+1 depuis le manifeste public ;
2. le téléchargement et la vérification de signature ;
3. l’installation dans le bundle existant ;
4. le redémarrage du processus ;
5. la version N+1 devenue courante ;
6. la signature Developer ID et Gatekeeper après remplacement.

Ce parcours nécessite deux releases signées successives. La première version contenant le hook de certification sert de N lors de la publication suivante.
