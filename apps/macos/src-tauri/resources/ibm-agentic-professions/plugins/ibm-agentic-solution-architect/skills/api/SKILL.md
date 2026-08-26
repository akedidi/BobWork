---
name: api
description: "Concevoir une API cohérente, sécurisée et évolutive."
icon: architecture
---

# API

Utiliser ce skill pour concevoir une API cohérente, sécurisée et évolutive.

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

1. Partir des capacités et cas d’usage consommateurs.
2. Définir ressources/opérations, schémas, erreurs, pagination et idempotence.
3. Spécifier authn/authz, quotas, versionnement et compatibilité.
4. Documenter en OpenAPI et tester exemples et contrats.

## Livrable

Contrat OpenAPI, conventions, exemples et stratégie de cycle de vie.

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

- Le contrat est valide et testable.
- Les erreurs sont stables et actionnables.
- Aucun secret ni donnée sensible dans les exemples.
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.
