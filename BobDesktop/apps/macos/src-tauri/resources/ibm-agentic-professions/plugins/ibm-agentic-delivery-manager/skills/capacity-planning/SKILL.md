---
name: capacity-planning
description: "Calculer une capacité réaliste à partir de disponibilité et données historiques."
icon: delivery
---

# capacity-planning

Utiliser ce skill pour calculer une capacité réaliste à partir de disponibilité et données historiques.

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

1. Collecter jours ouvrés, absences, support et contraintes de compétences.
2. Utiliser throughput ou vélocité historique comparable.
3. Réserver capacité pour incidents, dette et travail non planifié.
4. Produire scénario central et plage prudente.

## Livrable

Plan de capacité par équipe, hypothèses, buffers et scénarios.

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

- Disponibilité n’égale pas capacité productive.
- Les compétences rares sont explicites.
- Les buffers reposent sur l’historique.
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.
