---
name: security
description: "Intégrer la sécurité par menace, contrôle et preuve."
icon: architecture
---

# security

Utiliser ce skill pour intégrer la sécurité par menace, contrôle et preuve.

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

1. Définir actifs, frontières de confiance, acteurs et obligations.
2. Modéliser menaces, abus et risques.
3. Sélectionner contrôles prévention, détection, réponse et récupération.
4. Relier contrôles à exigences, tests, journalisation et responsables.

## Livrable

Threat model, exigences, matrice de contrôles et risques résiduels.

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

- Moindre privilège et défense en profondeur.
- Les données sont classifiées sur tout leur cycle.
- Les risques résiduels ont un approbateur.
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.
