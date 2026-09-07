# Intégration Native du Login IBM SSO

Cette documentation détaille la façon dont Bob Work s'intègre avec IBM Bob Shell pour fournir une authentification web transparente (SSO) sans contourner les sécurités natives d'IBM.

## Architecture

Le défi principal réside dans l'absence d'une commande `bob auth login` dans la version 2.0.0. 
Le CLI Bob ne déclenche l'ouverture du portail SSO IBM que lorsqu'on lance une session interactive (`bob chat`).

De plus, `bob chat` exige impérativement un terminal interactif (TTY/PTY).

L'architecture mise en place est la suivante :

1. **PTY Rust (`portable-pty`)** : Le backend Rust crée un Pseudo-Terminal virtuel.
2. **Spawn de `bob chat`** : Le binaire `bob` est exécuté à l'intérieur de ce PTY. Il est ainsi "trompé" et s'exécute comme s'il était lancé par un utilisateur.
3. **Analyse de Flux (Stdout Parsing)** : Un thread Rust lit en continu le flux du PTY et recherche des mots-clés :
   - `Browser` : Déclenche l'événement `browser_opened` (l'UI affiche "Connexion en cours").
   - `License` : Déclenche l'événement `license_required` (pour acceptation manuelle).
   - `trust this folder` : Indique que Bob est connecté et prêt.
4. **Fermeture de la boucle** : Bob Work met à jour l'état de l'application vers `FULLY_READY` et ferme la session PTY. L'état d'authentification persistera via la configuration native de Bob (`~/.bob/config.json`).
