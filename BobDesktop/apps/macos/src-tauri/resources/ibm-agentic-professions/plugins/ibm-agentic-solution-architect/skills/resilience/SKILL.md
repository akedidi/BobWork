---
name: resilience
description: "Concevoir la continuité face aux pannes réalistes."
icon: architecture
---

# resilience

Utiliser ce skill pour concevoir la continuité face aux pannes réalistes.

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

1. Définir services critiques, SLO, RTO, RPO et dépendances.
2. Modéliser zones de panne et scénarios de défaillance.
3. Choisir redondance, isolation, dégradation, sauvegarde et reprise.
4. Planifier tests de restauration, game days et observabilité.

## Livrable

Resilience model, scénarios, patterns, runbooks et plan de test.

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

- Backup n’implique pas restauration prouvée.
- Les dépendances tierces sont incluses.
- Le coût est proportionné à la criticité.
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.
