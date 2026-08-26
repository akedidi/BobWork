---
name: architecture-review
description: "Évaluer une architecture contre exigences, drivers et risques."
icon: architecture
---

# architecture-review

Utiliser ce skill pour évaluer une architecture contre exigences, drivers et risques.

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

1. Fixer périmètre, maturité, critères et preuves attendues.
2. Rejouer scénarios fonctionnels, qualité, sécurité, panne et exploitation.
3. Vérifier cohérence des vues, décisions et roadmap.
4. Classer constats, risque, recommandation, propriétaire et échéance.

## Livrable

Review report avec verdict, risques, actions et décisions requises.

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

- Les constats citent une preuve.
- Bloquants séparés des améliorations.
- Le verdict est conditionné à des critères mesurables.
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.
