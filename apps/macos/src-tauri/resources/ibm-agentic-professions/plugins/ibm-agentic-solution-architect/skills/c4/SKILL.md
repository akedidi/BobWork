---
name: c4
description: "Communiquer l’architecture aux bons niveaux avec le modèle C4."
icon: architecture
---

# C4

Utiliser ce skill pour communiquer l’architecture aux bons niveaux avec le modèle C4.

## Entrées minimales

- objectif ou décision attendue ;
- périmètre, audience, échéance et contraintes ;
- sources disponibles, hypothèses et niveau de confiance ;
- format de sortie et critères d’acceptation.

Ne bloque pas sur une information secondaire : avance avec une hypothèse explicitement marquée. Demande une clarification lorsque l’hypothèse changerait matériellement la décision, le risque ou le périmètre.

## Méthode

1. Commencer par System Context et audience.
2. Ajouter Container pour les responsabilités et technologies majeures.
3. Créer Component seulement si utile à une audience technique.
4. Nommer éléments par fonction et relations par verbes, avec légende.

## Livrable

Diagrammes C4 source et rendus avec descriptions et portée.

Inclure systématiquement : synthèse décisionnelle, faits et sources, hypothèses, limites, actions, responsables et prochaines validations lorsque ces éléments s’appliquent.

## Contrôles qualité

- Un niveau d’abstraction cohérent par vue.
- Chaque élément et relation est nommé.
- Le diagramme reste lisible sans narration orale.
- Distinguer clairement fait, estimation, hypothèse et recommandation.
- Ne jamais inventer une donnée, une référence client, une conformité ou une validation.
- Pour une information susceptible d’avoir changé, vérifier une source primaire actuelle et noter la date de consultation.

## Ressources

Consulter `../../references/sources.md` pour les sources officielles et `../../references/deliverable-contract.md` pour le protocole commun de livraison. Les cadres propriétaires cités servent de repères : ne pas reproduire leurs supports protégés.
