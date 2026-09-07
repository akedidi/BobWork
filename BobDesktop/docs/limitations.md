# Bob Work 0.1.4 — limites connues et garanties

**Date de validation :** 9 août 2026  
**Bob Shell validé :** 2.0.0 (`7a5dcab1`)  
**Cible du DMG :** macOS 12+, Apple Silicon

Ce document distingue volontairement ce qui est exécuté par Bob Work, ce qui dépend de Bob Shell et ce qui nécessite une configuration externe.

## Garanties de cette version

- Les projets, conversations, tâches, occurrences planifiées, événements, sources, réglages et index de recherche sont conservés dans SQLite sur le Mac.
- La clé API Bob est conservée dans un coffre local chiffré (AES-256-GCM) dans le dossier de données de l’application. Elle n’est jamais écrite en clair dans SQLite ni dans les journaux, et est injectée uniquement dans le processus `bob run` concerné. Aucun Trousseau macOS n’est utilisé.
- Les jetons manuels GitHub, Slack et Monday.com suivent le même coffre local chiffré et restent disponibles après redémarrage de Bob Work jusqu’à effacement explicite.
- Bob Work ne propose plus de faux avantage SSO : aucune connexion interactive IBM n’est requise par l’application, car le moteur headless utilisé est `bob run`.
- Aucune réponse Bob simulée n’est utilisée dans le bundle de production. Une absence de Shell ou d’authentification produit une erreur visible.
- Les plugins Bob Work sont des bundles locaux pouvant réunir un skill natif `SKILL.md`, des scripts, des serveurs MCP, des exigences d’intégration, des capacités navigateur, des hooks locaux contrôlés et des modèles de tâches planifiées. L’installation, l’activation, la désactivation et la suppression appliquent le même cycle de vie aux serveurs MCP. Les noms sont isolés par plugin et les secrets littéraux sont refusés dans le manifeste.
- Chaque version de plugin respecte SemVer et devient immuable après sa détection. Les bundles agentiques sont copiés sous `~/.bob/skills/.bob-work-versions/` avant installation. Une mise à jour reste inactive jusqu’à validation, les différences fonctionnelles et d’autorisations sont affichées, et une restauration remet en place le skill, les scripts, hooks et serveurs MCP de la version choisie sans changer les connexions ni le choix activé/désactivé. Une archive est limitée à 5 000 fichiers et 100 Mo.
- Les hooks déclarés s’exécutent uniquement avec un environnement minimal sans clé Bob ni jeton d’intégration. Un hook obligatoire en échec arrête la tâche ; son début, sa fin ou son erreur apparaissent dans l’activité agentique.
- Les événements structurés de Shell 2 sont enregistrés comme activité, appels d’outils, sources, entrées et sorties. L’application n’affiche pas de chaîne de pensée privée.

## Authentification IBM

Bob Shell 2 exige une clé pour le moteur headless `bob run` utilisé par Bob Work. La clé est lue depuis le coffre local chiffré et injectée sous `BOB_API_KEY` et `BOBSHELL_API_KEY` uniquement dans le processus enfant. Aucun Trousseau macOS n’est utilisé. Le login interactif de `bob chat` n’est plus proposé.

## Tâches et planification

- Fermer la fenêtre masque Bob Work dans la barre de menus : le moteur continue donc à travailler lorsque l’écran est verrouillé, tant que le Mac est éveillé et que l’utilisateur n’a pas quitté l’application.
- L’option « lancer à la connexion » redémarre Bob Work automatiquement après ouverture de session.
- Une extinction, un redémarrage avant ouverture de session, un `Quitter` explicite ou le sommeil profond arrêtent le moteur. La politique `run_on_wake` rattrape les occurrences manquées au prochain réveil/lancement ; `skip` les ignore et `ask` les met en attente.
- macOS peut retarder un processus selon ses politiques d’énergie. Cette version ne tente pas d’empêcher le sommeil du Mac.
- Les expressions cron et les récurrences guidées sont évaluées dans le fuseau enregistré. Les politiques de chevauchement `queue`, `ignore`, `cancel_old` et `ask` sont persistées et appliquées.

## File d’attente des prompts

- Pendant une réponse Bob Shell, le composeur reste éditable. Entrée ajoute le prompt, son mode, son projet et ses pièces jointes à la file de la conversation au lieu de lancer une session concurrente.
- Les prompts en attente peuvent être réordonnés, retirés individuellement ou vidés. Ils démarrent strictement l’un après l’autre après l’événement final de la session active, y compris après un échec ou un arrêt manuel.
- Fermer la fenêtre conserve la file puisque Bob Work reste actif dans la barre des menus. Un `Quitter` explicite ou un crash supprime les prompts qui n’avaient pas encore démarré ; seuls les messages déjà envoyés et les tâches créées figurent dans SQLite.

## Permissions

Bob Work conserve l’historique des décisions et les autorisations révocables. Bob Shell reste néanmoins l’autorité finale pour l’exécution de ses outils. Les portées mémorisées servent à l’audit et à la politique de Bob Work ; elles ne doivent pas être considérées comme un contournement des confirmations imposées par Shell ou macOS.

Les permissions macOS — Microphone, Reconnaissance vocale, Notifications, Accessibilité et Automation — doivent être accordées dans Réglages Système. Bob Work ne peut pas les préautoriser.

## Web, Computer Use et Chrome

- L’accès Web est réalisé uniquement si le mode/outillage Bob sélectionné le permet. Le réglage désactivé ajoute une contrainte locale au contexte, mais cette version ne constitue pas un pare-feu réseau du processus Bob.
- Le panneau droit peut conserver plusieurs onglets Web et ouvrir les sources sans quitter la conversation. Certains sites appliquent `X-Frame-Options` ou une politique CSP qui interdit leur affichage dans un cadre intégré ; le bouton d’ouverture dans le navigateur système reste alors disponible. Les onglets intégrés n’utilisent pas le profil ni les cookies de Chrome.
- Computer Use et Chrome sont des MCP first-party (`bob-work-computer-use`, `bob-work-chrome-control`) activés depuis Réglages → Accès et contrôle. Les actions UI passent par un pont AppleScript dans Bob Work (identité TCC = l’app, pas python3). Il n’y a pas de moteur vision/AX embarqué : pas de clic sur capture d’écran, pas d’arbre d’accessibilité natif, pas de CDP.
- L’onboarding et la carte de statut listent les outils MCP (`tools/list`) et l’état Accessibilité / Automatisation. Un badge **Prêt** apparaît sur les plugins intégrés lorsque MCP + TCC sont accordés.

## Intégrations

GitHub, Slack et Monday.com disposent d’un assistant par jeton de session et d’un skill natif installé automatiquement. La portée réelle reste celle du jeton fourni.

Outlook, Teams, Outlook Calendar et OneDrive sont présents dans le catalogue, mais IBM/Microsoft n’a fourni à cette application ni client OAuth enregistré ni redirect URI. Ils doivent donc être reliés à un connecteur ou serveur MCP réel. Bob Work ne simule jamais leur état « connecté ».

Dans un plugin, une connexion `oauth` ou `mcp` doit référencer un serveur MCP déclaré. Bob Work sait confirmer que ce serveur est installé et actif, mais l’état affiché reste « MCP actif » tant que le fournisseur n’a pas confirmé l’autorisation du compte lors d’un appel réel. Seul le connecteur connaît la validité et l’expiration de ses jetons OAuth.

## Voix, usage et imports

- La langue de l’interface suit Réglages → Apparence : `auto` détecte le système (`fr` / `en` / `es`), sinon repli sur l’anglais. Un choix explicite force la langue.
- Bob Shell 2 n’expose pas de commande headless stable pour le quota mensuel. La limite restante affiche donc « non communiquée » plutôt qu’un chiffre inventé. Les événements d’usage d’une exécution sont conservés lorsqu’ils existent.
- Les imports Bob Work, ChatGPT et Claude/Cowork sont tolérants et versionnés. Un changement de format fournisseur peut laisser certains champs non reconnus ; le contenu importable est conservé sans exécuter de code issu de l’archive.

## Aperçu des documents

- Images, PDF, texte, Markdown, HTML, audio et vidéo disposent d’un rendu direct dans le panneau droit.
- Word, PowerPoint, Excel, RTF, Pages, Numbers, Keynote et OneNote utilisent une vignette Quick Look macOS. Selon le générateur Quick Look installé, il peut s’agir de la première page ou d’un aperçu réduit ; le fichier complet reste ouvrable dans son application native.
- Chaque fichier demandé est ajouté individuellement à la portée dynamique du protocole d’assets Tauri ; le cache Quick Look est la seule portée permanente. Les dossiers sensibles comme `.ssh`, `.gnupg` et le Trousseau sont explicitement refusés.

## Distribution

Les builds locaux sont signés **ad hoc** : Gatekeeper peut demander une validation dans Confidentialité et sécurité au premier lancement. Les releases GitHub passent par le workflow `release.yml`, qui exige un certificat **Developer ID Application**, notarie chez Apple et publie les artefacts de mise à jour signés. Sans les secrets Apple et Tauri documentés dans `docs/release-macos.md`, le workflow s’arrête avant le build au lieu de publier un binaire non signé. Bob Work ne demande aucun accès au Trousseau.

Le DMG livré est `aarch64`; un DMG universel Intel + Apple Silicon nécessite une compilation additionnelle de la cible x86_64 et une validation sur Mac Intel.
