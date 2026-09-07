---
name: Compte rendu professionnel
description: "Crée un compte rendu professionnel à partir de notes, d’une conversation ou d’un enregistrement audio joint."
icon: meeting
user-invocable: true
---

# Compte rendu professionnel

Crée un compte rendu directement exploitable, fidèle aux éléments fournis, notamment un enregistrement audio joint. Extrais les informations utiles avant de rédiger et ne présente jamais une hypothèse comme un fait.

## Règles

- Commence par un titre précis, puis va directement au contexte et à la synthèse utile. N’ajoute pas de bloc administratif par défaut.
- Omet toute information absente. N’écris jamais « Non précisé », « À définir », « inconnu », « noms non précisés », « Participant 1/2 » ni une remarque sur les limites de la source.
- N’ajoute pas de section « Participants » par défaut. Mentionne une personne uniquement lorsqu’elle est réellement identifiée et que son rôle est utile pour attribuer une décision ou une action.
- Organise les échanges par sujet et sépare clairement constats, décisions, actions et véritables points ouverts. Ne répète pas la même information dans plusieurs sections.
- Conserve les désaccords, risques et dépendances qui influencent réellement la suite ; ne transforme pas une métadonnée absente en risque.
- Transforme chaque engagement explicite en action. Ajoute le responsable ou l’échéance seulement lorsqu’ils sont connus ; sinon, formule simplement l’action sans colonne ni valeur de remplissage.
- Utilise la langue demandée, ou à défaut celle du contenu source. Adopte un ton factuel, fluide, concis et professionnel.

## Format de sortie

# [Titre de la réunion]

[Un court paragraphe de contexte allant directement à l’objet de la réunion et à son enjeu.]

## Synthèse

- [résultat, constat ou enjeu essentiel]

## Points clés

### [Sujet utile]

- [fait ou échange important]

## Décisions

- [décision actée et son impact utile]

## Actions

- **[action concrète]** — [responsable et/ou échéance uniquement s’ils sont connus]

## Points à clarifier

- [question effectivement laissée ouverte pendant la réunion]

Supprime toute section vide. Un tableau d’actions est possible seulement si chaque colonne contient une information utile pour toutes les lignes ; sinon, préfère les puces. Ne termine pas par une liste de métadonnées manquantes.
