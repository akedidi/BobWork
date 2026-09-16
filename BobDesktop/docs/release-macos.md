# Publication macOS de Bob Work

La publication est automatisée par `.github/workflows/release.yml`. Un tag
`vX.Y.Z` construit l’application, la signe avec le certificat Apple fourni,
publie le DMG et génère `latest.json` avec les archives signées pour l’updater
Tauri.

## Modèle de distribution actuel

Le certificat disponible est un certificat **Apple Development / Personal
Team**, pas un certificat Developer ID Application. Il permet de conserver la
même identité de code entre les installations et les mises à jour, mais il ne
permet ni notarisation Apple ni distribution publique acceptée automatiquement
par Gatekeeper.

En pratique :

- la première installation sur chaque Mac se fait avec le paquet source et
  `Install-Bob-Work.command`, qui compile et signe localement avec le même P12 ;
- les versions suivantes peuvent être téléchargées et vérifiées par l’updater
  Tauri grâce à sa paire de clés dédiée ;
- la politique de sécurité d’un Mac d’entreprise peut malgré tout bloquer le
  lancement ou le remplacement d’une application Apple Development. Ce point
  ne peut pas être contourné par l’updater et doit être validé sur les Macs IBM.

## Configuration GitHub Actions

Secrets :

- `APPLE_CERTIFICATE` : P12 Apple Development encodé en base64 ;
- `APPLE_CERTIFICATE_PASSWORD` et `KEYCHAIN_PASSWORD` ;
- `TAURI_SIGNING_PRIVATE_KEY` : clé privée de signature des artefacts Tauri.

Variables :

- `TAURI_UPDATER_PUBLIC_KEY` : clé publique correspondant exactement à la clé
  privée Tauri et à celle embarquée dans `tauri.conf.json` ;
- `BOBWORK_OAUTH_MICROSOFT_CLIENT_ID` : identifiant optionnel de l’application
  publique Entra ; sans lui, Microsoft 365 peut être configuré dans l’interface.

La clé privée Tauri ne doit jamais être commitée. La clé publique est embarquée
dans toutes les constructions de production, y compris celles du paquet source.
Le workflow refuse une release si la variable GitHub et la clé embarquée
diffèrent.

## Publier une version

1. Aligner la version dans `apps/macos/package.json`, `src-tauri/Cargo.toml` et
   `src-tauri/tauri.conf.json`.
2. Exécuter `pnpm --dir BobDesktop --filter macos run verify`.
3. Committer et pousser les sources de la version.
4. Créer et pousser le tag correspondant, par exemple `v0.2.0`.
5. Vérifier la release GitHub et
   `https://github.com/akedidi/BobWork/releases/latest/download/latest.json`.

Le workflow contrôle la signature Apple, l’absence d’identité ad hoc instable,
la version de `latest.json`, les URLs et la présence des signatures updater. Il
ne lance volontairement aucun contrôle de notarisation ou d’acceptation
Gatekeeper, car ils seraient mensongers avec un certificat Personal Team.

## Test updater N vers N+1

Le workflow manuel `.github/workflows/updater-smoke.yml` installe le DMG d’une
version N dans un dossier isolé puis vérifie :

1. la détection de N+1 depuis `latest.json` ;
2. le téléchargement et la vérification cryptographique Tauri ;
3. l’installation dans le bundle existant et le redémarrage ;
4. la version N+1 devenue courante ;
5. la validité et la stabilité de la signature Apple après remplacement.

Ce test nécessite deux releases successives utilisant la même clé updater et
la même identité Apple.
