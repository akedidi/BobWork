---
name: requirements-extraction
description: "Extraire des exigences atomiques, testables et traçables."
icon: rfp
---

# requirements-extraction

Utiliser ce skill pour extraire des exigences atomiques, testables et traçables.

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

1. Parcourir le corpus complet, tableaux, annexes et formulaires compris.
2. Scinder les phrases composites en obligations atomiques.
3. Classer obligatoire, évalué, informatif, contractuel ou ambigu.
4. Attribuer identifiant stable, source exacte, responsable et preuve attendue.

## Livrable

Registre d’exigences atomiques avec traçabilité source.

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

- Exhaustivité contrôlée par seconde passe.
- Les termes shall/must/doit et équivalents sont conservés.
- Les doublons restent reliés à toutes leurs sources.
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.
