# Résolution des Problèmes d'Authentification (Troubleshooting)

## Problème 1 : L'application bloque sur "Connexion en cours"
- **Cause probable** : Le navigateur n'a pas pu être ouvert par Bob Shell, ou l'utilisateur a fermé l'onglet avant la fin de la connexion.
- **Solution** : Cliquez sur "Annuler" dans l'interface et recommencez. Si le navigateur ne s'ouvre toujours pas, ouvrez un terminal macOS et lancez `bob chat` manuellement pour voir s'il y a une erreur bloquante (ex: licence, nodejs manquant).

## Problème 2 : Demande de "Trust Folder" inattendue
- **Cause probable** : Bob Shell exige qu'un dossier soit approuvé avant de lancer la session interactive.
- **Solution** : L'implémentation PTY détecte ce message et valide automatiquement que la session a été ouverte (puisque l'invite "Trust this folder" ne s'affiche qu'à un utilisateur authentifié).

## Problème 3 : Les tâches en arrière-plan échouent avec une erreur 401/403
- **Cause probable** : Vous essayez de faire tourner des tâches sans avoir configuré de clé d'automatisation, ou celle-ci est expirée.
- **Solution** : Allez dans `Paramètres -> IBM Bob` et générez une nouvelle clé d'Inférence depuis le portail IBM, puis collez-la dans Bob Work.
