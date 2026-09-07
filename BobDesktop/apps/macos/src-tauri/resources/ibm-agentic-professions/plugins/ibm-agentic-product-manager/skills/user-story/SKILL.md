---
name: user-story
description: "Découper la valeur en stories petites, testables et indépendantes lorsque possible."
icon: product
---

# user-story

Utiliser ce skill pour découper la valeur en stories petites, testables et indépendantes lorsque possible.

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

1. Formuler utilisateur, besoin et bénéfice.
2. Ajouter contexte, règles, exemples et critères d’acceptation.
3. Découper verticalement par scénario ou valeur.
4. Identifier dépendances, NFR, instrumentation et définition de terminé.

## Livrable

Stories prêtes, critères Given/When/Then si utiles et liens de traçabilité.

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

- Pas de story purement technique sans résultat explicité.
- Les critères couvrent erreurs et permissions.
- La taille permet feedback rapide.
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.
