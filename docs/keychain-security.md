# Coffre local chiffré — sans Trousseau macOS

Bob Work n’utilise pas le Trousseau macOS pour éviter les demandes d’autorisation répétées à chaque lancement.

## Principe

- Les secrets (clé IBM Bob, jetons GitHub/Slack/Monday) sont stockés dans un **coffre local chiffré** dans le dossier de données de l’application.
- Chiffrement **AES-256-GCM** avec une clé locale générée une fois (`.vault.key`, permissions `0600`).
- Contenu chiffré dans `secrets.vault` — jamais en clair dans SQLite ni dans les journaux.
- **Persistant** : disponible après redémarrage de Bob Work, sans resaisie.
- **Sans prompt macOS** : aucun entitlement Keychain, aucune popup « autoriser l’accès au Trousseau ».

## Fichiers

| Fichier | Rôle |
|---------|------|
| `{app_data}/.vault.key` | Clé AES locale (32 octets, `0600`) |
| `{app_data}/secrets.vault` | Coffre chiffré (nonce + ciphertext, `0600`) |

## Migration

- Ancien fichier en clair `~/.bobwork_secrets.json` → importé puis supprimé au premier lancement.
- Ancien `bob-api-vault.json` non supporté → supprimé.

## Effacement

- Réglages → IBM Bob Shell → **Effacer du coffre**
- Intégrations → **Déconnecter** sur chaque service

## Limites

- La protection repose sur les permissions du compte macOS et le chiffrement local. Un accès root ou une copie simultanée de `.vault.key` + `secrets.vault` permettrait la récupération.
- Les jetons OAuth Microsoft/Google appartiennent au connecteur MCP ; Bob Work ne les duplique pas dans ce coffre.
