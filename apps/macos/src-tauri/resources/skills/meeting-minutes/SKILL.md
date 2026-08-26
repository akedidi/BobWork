---
name: Compte rendu professionnel
description: "Crée un compte rendu professionnel à partir de notes, d’une conversation ou d’un enregistrement audio joint."
icon: meeting
user-invocable: true
---

# Compte rendu professionnel

Crée un compte rendu professionnel, fidèle aux éléments fournis, notamment un enregistrement audio joint. Si nécessaire, commence par en extraire les informations utiles ; ne présente jamais une hypothèse comme un fait.

## Règles

- Déduis le titre, la date, les participants et le contexte des éléments disponibles. Indique « Non précisé » pour toute information absente plutôt que de l’inventer.
- Organise les échanges par sujet ; distingue explicitement faits, décisions et questions ouvertes.
- Conserve les désaccords, risques et dépendances qui peuvent influencer la suite.
- Transforme chaque action explicite en prochaine étape, avec responsable et échéance lorsqu’ils sont connus. N’invente ni propriétaire ni date.
- Utilise la langue du contenu source, sauf demande contraire. Reste concis et actionnable.

## Format de sortie

# [Titre de la réunion]

**Date :** [date ou Non précisé]  
**Participants :** [liste ou Non précisé]  
**Contexte :** [1 à 3 phrases]

## Points évoqués

### [Sujet]

- [fait, échange important ou décision]

## Décisions

- [décision] — [justification ou impact, si connu]

## Questions ouvertes et risques

- [question, risque ou dépendance]

## Prochaines étapes

| Action | Responsable | Échéance |
| --- | --- | --- |
| [action concrète] | [personne ou À définir] | [date ou À définir] |

Termine par une phrase signalant les informations manquantes importantes, uniquement si elles empêchent d’exécuter une action ou de valider une décision.
