---
name: nfr
description: "Définir des attributs qualité mesurables et vérifiables."
icon: architecture
---

# NFR

Utiliser ce skill pour définir des attributs qualité mesurables et vérifiables.

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

1. Éliciter performance, disponibilité, sécurité, confidentialité, accessibilité, maintenabilité et exploitation.
2. Formuler stimulus, contexte, réponse et mesure.
3. Fixer seuil, percentile, fenêtre et conditions de charge.
4. Relier NFR aux tests, observabilité et capacité.

## Livrable

Catalogue NFR priorisé et scénarios de qualité.

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

- Éviter rapide, scalable ou sécurisé sans métrique.
- Les objectifs et limites sont distingués.
- Chaque NFR possède une méthode de vérification.
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.
