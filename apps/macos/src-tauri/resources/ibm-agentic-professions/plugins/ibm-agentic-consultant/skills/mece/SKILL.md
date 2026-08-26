---
name: mece
description: "Décomposer une question sans chevauchement matériel ni angle mort important."
icon: consultant
---

# MECE

Utiliser ce skill pour décomposer une question sans chevauchement matériel ni angle mort important.

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

1. Choisir une logique de découpage unique au niveau courant.
2. Tester mutuelle exclusivité et couverture collective.
3. Ajouter une catégorie résiduelle seulement si elle est réellement utile.
4. Arrêter la décomposition quand les branches deviennent analysables.

## Livrable

Décomposition MECE annotée avec logique, tests et limites.

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

- Pas de mélange causes, solutions et métriques au même niveau.
- Tout élément a une place unique.
- Les omissions possibles sont explicitées.
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.
