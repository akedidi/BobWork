---
name: adr
description: "Consigner une décision d’architecture et ses conséquences."
icon: architecture
---

# ADR

Utiliser ce skill pour consigner une décision d’architecture et ses conséquences.

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

1. Donner titre de décision et statut.
2. Décrire contexte, drivers et contraintes.
3. Lister options considérées et décision avec rationnel.
4. Documenter conséquences positives, négatives et déclencheurs de revue.

## Livrable

ADR court, versionné et relié aux exigences et vues.

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

- Une décision principale par ADR.
- Les alternatives rejetées sont conservées.
- Le statut et la date sont explicites.
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.
