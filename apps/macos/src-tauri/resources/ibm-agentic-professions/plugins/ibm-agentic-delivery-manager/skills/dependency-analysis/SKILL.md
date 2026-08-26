---
name: dependency-analysis
description: "Identifier et réduire les dépendances qui menacent le flux."
icon: delivery
---

# dependency-analysis

Utiliser ce skill pour identifier et réduire les dépendances qui menacent le flux.

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

1. Cartographier fournisseur, consommateur, objet, date et criticité.
2. Distinguer dépendances techniques, équipe, décision, environnement et fournisseur.
3. Choisir éliminer, découpler, avancer, synchroniser ou escalader.
4. Suivre signaux précoces et propriétaire jusqu’à fermeture.

## Livrable

Dependency map, chemin critique et actions de mitigation.

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

- Chaque dépendance a deux propriétaires.
- La date nécessaire est explicite.
- Les dépendances critiques apparaissent dans le plan de sprint/release.
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.
