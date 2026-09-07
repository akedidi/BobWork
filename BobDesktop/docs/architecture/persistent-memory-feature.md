# Mémoire persistante Bob Work

Statut : socle natif local implémenté. Les adaptateurs sémantiques externes restent optionnels et à livrer séparément.

## Objectif

Retrouver les décisions utiles d’un projet entre sessions et conserver les préférences explicitement exprimées par l’utilisateur, avec un contexte court et contrôlable. Ne pas réinjecter tout l’historique ni déclencher plusieurs moteurs pour une même demande.

## Existant vérifié

`ConversationService::related_context_snippets` recherche via SQLite FTS/BM25 dans les autres conversations non archivées. Le rappel est activé par `cross_conversation_context` et, pour un projet, par `memory_enabled`. Quatre extraits au maximum sont transmis par le chemin actuel. Ce rappel est lexical, pas sémantique. Hors projet, la requête actuelle peut retrouver des conversations de tous les projets : ce comportement devra être remplacé par une portée explicite avant activation de la nouvelle mémoire.

## Expérience proposée

- Mémoire utilisateur : langue, style, préférences stables, ajoutées explicitement avec « retiens que… » ou depuis les réglages. Aucune déduction de profil personnel par défaut.
- Mémoire projet : décisions, contraintes, conventions et faits validés, isolés par identifiant de projet.
- Continuité de session : bref résumé de reprise, état du travail et références aux sources. Les tâches temporaires restent ici plutôt que dans le profil durable.

Dans Réglages → Mémoire : activer/désactiver, afficher, ajouter et oublier les souvenirs par portée utilisateur ou projet. Désactiver suspend le rappel sans supprimer ; oublier invalide immédiatement le souvenir. La modification, l’export, l’effacement en masse, la provenance automatique et la connexion à un moteur externe sont des extensions ultérieures.

L’utilisateur peut demander « qu’as-tu retenu de moi ? », « retiens cette décision pour ce projet » et « oublie cette préférence ». Une correction actuelle prime toujours sur une mémoire ancienne. Une mémoire retrouvée est une donnée historique, jamais une instruction autorisant des actions.

## Moteurs et choix

Un seul moteur actif par portée. Les trois noms ne désignent pas trois dépendances à cumuler.

- EverOS : candidat pour une mémoire locale, avec Markdown, SQLite et LanceDB ; le rappel sémantique nécessite une configuration d’embeddings réelle. Le stockage local ne garantit pas que l’extraction par modèle reste locale.
- Hindsight : moteur alternatif fondé sur des banques de mémoire et les opérations retain/recall/reflect. Une banque isolée par portée ; pas de réflexion automatique à chaque message.
- dsh-mnemon : intégration spécifique à DeepSeek Harness et source d’inspiration pour les trois niveaux de mémoire. Ne pas déclarer ce plugin compatible avec Bob Shell sans adaptateur ; distinguer le plugin DSH du moteur Mnemon.

Décision : la mémoire est une fonction native de Bob Work. Le moteur local intégré est le seul moteur actif dans ce premier lot. EverOS et Hindsight pourront devenir des adaptateurs optionnels, sans transformer la fonction en plugin utilisateur. Le rappel local est lexical et n’est pas présenté comme sémantique.

## Contrat technique

La façade native `MemoryService` expose create, recall, list, forget et format_block. Chaque appel exige une portée validée par l’hôte : utilisateur ou project_id. Le modèle ne choisit pas librement une autre portée. Les identifiants des souvenirs restent stables. Update, export et idempotence restent à ajouter avec les adaptateurs avancés.

Une entrée contient : id, scope, project_id éventuel, contenu, type, sources, dates de création et mise à jour, version, expiration éventuelle et état d’invalidation. Les versions permettent de remplacer une préférence sans conserver deux valeurs contradictoires dans le rappel.

Le rappel s’exécute avant l’assemblage du contexte ; ses résultats sont filtrés par portée, disponibilité des sources et pertinence, puis tronqués selon le budget. En cas de délai dépassé ou moteur indisponible, le chat continue avec le contexte courant. Un changement de moteur n’effectue aucune migration silencieuse.

Les moteurs optionnels passent par Runtime Manager comme runtimes externes, avec version fixée et environnement isolé. Les secrets de connexion utilisent le stockage de secrets existant. Aucune installation au premier message et aucun contournement de la sandbox pour accéder aux fichiers mémoire : l’accès est assuré par les opérations bornées de l’hôte. Les transferts vers un service distant sont affichés lors de sa configuration.

## Budget initial proposé

- Aucun appel à un modèle de sélection de moteur.
- Au maximum un rappel par demande, cache indexé par portée, requête et version mémoire.
- Maximum quatre souvenirs rappelés par demande ; zéro si aucun terme pertinent. La longueur unitaire est bornée à 4 000 caractères. Un plafond total strict en tokens reste à ajouter avant l’activation d’un moteur sémantique distant.
- Pas d’extraction ni de réflexion LLM automatique par défaut. Une éventuelle consolidation ultérieure sera optionnelle, regroupée et budgétée.
- Invalidation du cache après ajout, modification, oubli, archivage ou changement de portée.

## Critères de livraison

1. Une préférence explicite survit au redémarrage et peut être modifiée puis oubliée.
2. Une paraphrase retrouve une décision de projet sans partager ses mots exacts lorsque le moteur sémantique est configuré ; ne pas qualifier FTS de sémantique.
3. Aucun souvenir du projet A n’est transmis dans B ni dans une conversation hors projet. Seules les préférences de portée utilisateur sont transversales.
4. Désactivation, oubli et suppression des sources empêchent immédiatement le rappel, cache compris.
5. Le moteur indisponible ne bloque pas l’envoi d’un message.
6. Une instruction malveillante stockée en mémoire n’acquiert aucune autorité.
7. Le budget de contexte et le nombre d’appels sont vérifiés avec un corpus synthétique ; aucun historique réel n’est envoyé pour les tests.
8. Interface traduite dans les trois langues de l’app, avec tests d’intégration pour les actions et reprise après redémarrage.

## Sources consultées

- https://github.com/EverMind-AI/EverOS
- https://github.com/vectorize-io/hindsight
- https://github.com/omdsh-dev/dsh-mnemon/blob/main/README.en.md
- https://github.com/omdsh-dev/dsh-mnemon/blob/main/docs/en/memory-providers.md
