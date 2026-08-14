# Résolution des problèmes d’authentification

Bob Work pilote **`bob run`** (headless). L’authentification peut venir :
1. d’une **clé d’inférence** dans le coffre local chiffré / variables d’environnement, ou
2. d’une **session IBM Bob Shell déjà connectée** (`~/.bob/settings/auth-secrets.json`, comme l’IDE).

## « Non installé » alors que `bob --version` marche

- **Cause** : lancement GUI avec un PATH minimal, ou détection bloquée trop longtemps sur les appels d’aide.
- **Solution** : Réglages → IBM Bob Shell → **Revérifier**. Le binaire est cherché dans `~/.local/bin`, Homebrew, etc. Vérifier aussi `bob --version` dans un terminal.

## La clé / session est refusée / tâches 401–403

- **Cause** : pas de clé coffre, pas de session SSO IBM Bob, ou jeton expiré.
- **Solution** : ouvrir IBM Bob / Bob Shell et vous reconnecter, **ou** Réglages → IBM Bob Shell → coller une clé d’inférence depuis le portail IBM. La clé coffre est réutilisée après redémarrage (y compris pour les planifications).

## Bob Shell introuvable

- **Cause** : binaire `bob` absent du PATH / chemin personnalisé incorrect.
- **Solution** : installer Bob Shell (Réglages ou onboarding), ou définir `BOB_WORK_BOB_PATH`. Vérifier avec `bob --version` dans un terminal.

## Planifications qui échouent « aucune clé »

- **Cause** : ni coffre, ni session SSO au moment du tick.
- **Solution** : rester connecté à IBM Bob Shell, ou saisir une clé dans Réglages avant l’heure planifiée.

## Planifications qui échouent « approbation requise »

- **Cause** : le **préflight unattended** bloque le lancement planifié s’il manque une clé coffre / session SSO, ou un grant utilisateur « Toujours », lorsque la politique est restrictive (`always_ask`, `ask_for_modifications`, ou `ask_for_important` avec Computer Use / Chrome). **`never_ask` ne bloque pas.** Le démarrage interactif de `bob run` reste autorisé sans ce préflight. Une planification peut aussi rester `awaiting_approval` pour une action mid-run (plugin, fichier, réseau).
- **Solution** : enregistrer une clé dans Réglages (coffre), rester connecté à IBM Bob Shell, et accorder « Toujours autoriser » pour les actions sensibles — ou passer en `never_ask` / `ask_for_important` selon le besoin. Le mode sandbox continue de refuser `--trust`.

## OAuth Microsoft / intégrations

- **Cause** : le build ne contient pas encore le Client ID public Entra, ou l’administrateur n’a pas consenti aux portées Graph demandées.
- **Solution** : pour une release, définir `BOBWORK_OAUTH_MICROSOFT_CLIENT_ID` dans les variables GitHub ; en développement, le définir dans `.env` ou saisir le Client ID UUID dans Intégrations. Aucun secret client n’est requis : Bob Work utilise le navigateur système, PKCE et le redirect loopback `127.0.0.1`. Le jeton Graph manuel reste disponible comme secours.

## Ancien flux `bob chat` / Trust Folder

Obsolète pour Bob Work 0.1.4+. L’application n’ouvre plus de session PTY interactive pour l’auth.
