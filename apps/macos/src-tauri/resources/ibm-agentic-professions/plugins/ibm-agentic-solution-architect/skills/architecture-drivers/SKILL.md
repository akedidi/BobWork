---
name: architecture-drivers
description: "Prioriser les forces qui structurent réellement l’architecture."
icon: architecture
---

# architecture-drivers

Utiliser ce skill pour prioriser les forces qui structurent réellement l’architecture.

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

1. Collecter objectifs métier, NFR critiques, contraintes, risques et principes.
2. Évaluer impact, volatilité et pouvoir discriminant.
3. Retenir un petit ensemble de drivers dominants.
4. Tester chaque option contre ces drivers.

## Livrable

Driver map priorisée avec implications architecturales.

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

- Les drivers ne sont pas une copie de toutes les exigences.
- Les conflits sont visibles.
- La priorité est validée par les décideurs.
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.
