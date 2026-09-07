# Computer Use autonome et visible

Statut : première version implémentée pour la boucle bornée, le défilement, le pointeur visible et la validation native. La détection d’une reprise physique souris/clavier reste à ajouter.

## Existant constaté

Bob Work expose des outils MCP dans `resources/computer/computer_use_mcp.py`. Le service `computer_use_mcp.rs` déploie ce serveur. Les entrées souris et clavier passent par `macos_applescript_bridge.rs` dans le processus macOS de Bob Work. Le chat possède déjà un stockage et une résolution de validations dans `commands/approval.rs` ; il faut y raccorder le contrôle desktop, sans confondre cette présence avec une validation effective de chaque action.

## Boucle intégrée

États : inactive, observation, proposition, attente de validation, exécution, vérification, pause, terminée, erreur.

L’hôte observe l’application cible par accessibilité et produit des identifiants d’éléments attachés à un instantané. Si les informations sont insuffisantes, une capture de la fenêtre complète l’observation. Le modèle propose une seule action structurée. L’hôte vérifie la cible, l’état courant et les autorisations, exécute puis observe à nouveau. La réussite d’un appel système ne suffit pas à déclarer l’objectif atteint.

Un plan ne préautorise pas une série de clics. Tout changement de fenêtre ou d’application invalide les coordonnées anciennes. La conversion des coordonnées vision doit tenir compte de l’origine de l’écran, des écrans multiples et du facteur Retina.

Les actions comprennent clic AX, clic par coordonnées, saisie, touche, défilement, attente courte et fin. Préférer AX ; réserver les coordonnées aux cibles observées visuellement. Pas de commande AppleScript arbitraire accessible à cette boucle, car elle contournerait le contrôle d’action.

## Actions visibles

Le pointeur distinct portant le nom « Bob » est une surcouche transparente non interactive, avec un cercle lors d’un clic. Il représente la position d’action propre à Bob et ne déplace jamais le curseur macOS réel. Une action AX est signalée même si elle ne passe pas par des événements de souris globaux.

La surcouche suit les coordonnées globales et disparaît à la pause, à la fin ou à la perte de cible. Elle doit être exclue des captures utilisées par le modèle. Pour une action invisible en arrière-plan, afficher la cible dans le chat ; ne pas dessiner un pointeur trompeur sur une autre fenêtre. Si l’utilisateur choisit le curseur macOS réel, les actions par coordonnées doivent déplacer ce curseur et céder immédiatement lors d’une reprise manuelle.

## Validation dans le chat

Avant une action sensible, afficher l’application, l’action concrète et son effet : envoyer, publier, supprimer, acheter, modifier une autorisation ou transmettre des fichiers. Boutons : Autoriser cette action et Refuser. Navigation et observation ordinaires continuent dans le périmètre autorisé.

La décision est liée à la conversation, l’exécution, l’application, l’instantané et l’empreinte des arguments. Elle est consommable une seule fois. Une cible modifiée exige une nouvelle observation et, si nécessaire, une nouvelle décision. Le refus, l’expiration ou l’arrêt ne doivent jamais exécuter l’action.

La validation est appliquée par l’hôte au point d’exécution, y compris aux appels MCP directs : une simple instruction au modèle ne constitue pas une barrière. Lorsque le risque d’une action est ambigu, l’exécution attend une décision. Les champs sécurisés ne sont pas lus et les valeurs sensibles ne figurent pas dans les journaux.

## Contrôle utilisateur

Le chat affiche l’application contrôlée, l’étape courante et Pause / Arrêter. L’utilisateur qui reprend la souris ou le clavier met la boucle en pause ; les événements synthétiques de Bob sont distingués des événements physiques. Une reprise nécessite une nouvelle observation.

Budget initial proposé : 20 actions et 2 minutes par exécution ; arrêt après trois observations sans progrès. Ces limites sont mesurées par l’hôte. Ne pas agir sur Bob Work lui-même ni sur les contrôles servant à autoriser ses propres actions. Respecter les restrictions de session et les permissions macOS existantes.

## Validation requise avant livraison

- Parcours AX puis repli vision sur une application de test, avec clic, saisie et défilement.
- Vérification d’effet après chaque action, détection d’absence de progrès et cible périmée.
- Refus, expiration, arrêt et réutilisation d’autorisation : aucune entrée système émise.
- Appel MCP direct soumis au même contrôle qu’une action de la boucle.
- Pointeur visible et correctement aligné en Retina et multi-écrans ; surcouche absente des captures du modèle.
- Reprise manuelle, permissions refusées, fermeture de fenêtre et déconnexion du serveur MCP.
- Interface et messages dans les trois langues de Bob Work.

La première version impose actuellement l’alternance observation/action, une limite de 20 actions et le bouton Arrêter déjà présent dans le chat. Le canal natif transmet les validations sensibles à la carte d’approbation existante et interrompt l’attente si la tâche est annulée. Le pointeur distinct « Bob » apparaît pour les clics et défilements et sa fenêtre est protégée contre la capture.

Restent pour une version ultérieure : détection fiable d’une reprise physique souris/clavier, bouton Pause avec reprise de processus et validation visuelle multi-écrans automatisée. Un test simulé de MCP ne valide pas les permissions système.
