# Capacités d'Authentification Bob Shell

Basé sur l'inspection de la version `2.0.0` de Bob Shell.

## Fonctionnalités Confirmées
- **Authentification Interactive Implicite** : Lancée via `bob chat` dans un PTY, elle ouvre automatiquement le navigateur pour le SSO.
- **Stockage Interne** : Bob gère lui-même les jetons de session sans les exposer à Bob Work.
- **Acceptation de Licence** : Gérée via l'option `-accept-license`.

## Limites
- **Pas de Logout** : Il n'existe pas de commande `bob logout` officielle. Pour forcer la reconnexion, l'utilisateur doit révoquer l'accès depuis le portail IBM ou vider manuellement `~/.bob/config.json`.
- **Pas de Vérification Explicite** : Pas de commande `bob whoami` ou `bob status`.
- **Informations Partielles** : Impossible de récupérer l'Email de l'utilisateur, l'Équipe, ou le Budget restant depuis le CLI.
