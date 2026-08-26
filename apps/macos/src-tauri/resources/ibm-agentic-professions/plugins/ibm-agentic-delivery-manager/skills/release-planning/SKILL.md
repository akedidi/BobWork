---
name: release-planning
description: "Préparer une release sûre, observable et réversible."
icon: delivery
---

# release-planning

Utiliser ce skill pour préparer une release sûre, observable et réversible.

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

1. Définir scope, critères d’entrée/sortie, dépendances et fenêtre.
2. Coordonner tests, données, sécurité, opérations, support et communication.
3. Concevoir rollout progressif, monitoring, rollback et responsabilités.
4. Exécuter go/no-go puis vérifier résultats et incidents post-release.

## Livrable

Release plan, checklist, RACI, communication, rollback et validation.

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

- Rollback testé ou procédure crédible.
- Métriques et alertes prêtes avant release.
- Le go/no-go a des critères objectifs.
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.
