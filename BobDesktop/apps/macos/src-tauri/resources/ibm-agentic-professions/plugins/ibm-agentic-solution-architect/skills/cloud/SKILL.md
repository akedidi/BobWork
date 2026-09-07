---
name: cloud
description: "Choisir et structurer les services cloud selon les drivers et garde-fous."
icon: architecture
---

# cloud

Utiliser ce skill pour choisir et structurer les services cloud selon les drivers et garde-fous.

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

1. Confirmer modèle de responsabilité, régions, contraintes et compétences.
2. Comparer services gérés, portabilité, dépendance et exploitation.
3. Concevoir comptes/subscriptions, réseau, identité, données et observabilité.
4. Vérifier capacités, limites et tarifs dans les sources fournisseur actuelles.

## Livrable

Landing-zone view, service map, décisions cloud et garde-fous.

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

- Aucun service supposé disponible sans vérification récente.
- Les limites régionales et quotas sont considérés.
- Le choix minimise la charge opérationnelle totale.
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.
