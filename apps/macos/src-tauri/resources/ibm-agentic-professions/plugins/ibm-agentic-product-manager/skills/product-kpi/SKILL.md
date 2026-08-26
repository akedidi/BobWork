---
name: product-kpi
description: "Définir un système de métriques actionnable et résistant aux effets pervers."
icon: product
---

# product-kpi

Utiliser ce skill pour définir un système de métriques actionnable et résistant aux effets pervers.

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

1. Relier North Star, inputs, outputs et guardrails au modèle de valeur.
2. Définir formule, population, fenêtre, source, fréquence et propriétaire.
3. Segmenter pour détecter moyennes trompeuses.
4. Fixer baseline, cible, seuil d’alerte et décision associée.

## Livrable

Metric tree et dictionnaire KPI avec gouvernance.

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

- Chaque KPI a une définition calculable.
- Leading et lagging indicators sont équilibrés.
- Des guardrails limitent l’optimisation locale.
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.
