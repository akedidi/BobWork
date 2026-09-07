---
name: integration
description: "Concevoir les échanges entre systèmes avec contrats et modes de défaillance."
icon: architecture
---

# integration

Utiliser ce skill pour concevoir les échanges entre systèmes avec contrats et modes de défaillance.

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

1. Inventorier producteurs, consommateurs, données, fréquences et criticité.
2. Choisir sync, async, batch ou event selon drivers.
3. Définir contrat, idempotence, ordre, retries, timeout et reprise.
4. Prévoir observabilité, sécurité, versionnement et ownership.

## Livrable

Integration catalog, séquences, contrats et gestion d’erreurs.

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

- Les pannes partielles sont couvertes.
- Les systèmes de référence sont explicites.
- Chaque interface a un propriétaire.
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.
