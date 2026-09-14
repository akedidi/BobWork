---
name: Meeting minutes
description: "Produce professional meeting minutes from notes, a conversation, or an audio recording — in the user's prompt language."
icon: meeting
user-invocable: true
---

# Meeting minutes

Produce polished, faithful meeting minutes from notes, a transcript, or an attached audio recording. Extract facts before writing. Never present a guess as a fact.

## Language (mandatory)

- **Write the entire output in the same language as the user's prompt** (the message that invoked this skill), including:
  - the document title
  - every section heading
  - labels, table headers, and bullet text
- If the prompt is in **English**, the minutes must be **100% English** — do not use French headings such as « Synthèse », « Points clés », « Décisions », or « Actions ».
- If the prompt is in **French**, the minutes must be **100% French** — do not use English headings such as « Executive summary », « Key discussion points », or « Action items ».
- When the prompt language is ambiguous, use the language of the prompt's main request sentence, not the source audio language alone.
- Never mix languages in a single document.

### Heading reference (use the column that matches the prompt language)

| English | Français | Español |
|---------|----------|---------|
| Executive summary | Synthèse | Resumen ejecutivo |
| Key discussion points | Points clés | Puntos clave |
| Decisions | Décisions | Decisiones |
| Action items | Actions | Acciones |
| Open items | Points à clarifier | Puntos abiertos |

## Content rules

- Open with a precise title, then a short context paragraph that states the meeting purpose and stakes. Do not add administrative boilerplate by default.
- Omit any information that is absent. Never write placeholders such as « TBD », « Not specified », « Unknown », « Participant 1/2 », or comments about missing metadata.
- Do not add a « Participants » section by default. Name someone only when they are clearly identified and their role matters for a decision or action.
- Group discussion by topic. Separate facts, decisions, actions, and genuinely open questions. Do not repeat the same point across sections.
- Keep disagreements, risks, and dependencies that affect next steps; do not invent risks from missing metadata.
- Turn every explicit commitment into an action. Add owner and due date only when known; otherwise state the action alone.

## Output format

Use this structure. **Translate every heading** to the prompt language using the table above.

```markdown
# [Meeting title]

[Optional one-line metadata only when known, e.g. **Date:** 9 September 2025 · **Format:** Weekly sync]

## [Executive summary / Synthèse / …]

[2–4 sentences: purpose, main outcomes, and what matters next.]

## [Key discussion points / Points clés / …]

### [Topic]

- [Important fact, argument, or exchange]

## [Decisions / Décisions / …]

- [Decision made and its practical effect]

## [Action items / Actions / …]

| Action | Owner | Due |
|--------|-------|-----|
| [Concrete task] | [Name, if known] | [Date, if known] |

Use the table only when at least one row has useful Owner or Due values; otherwise use bullets:

- **[Action]** — [Owner and/or due date, only if known]

## [Open items / Points à clarifier / …]

- [Question or topic left unresolved in the meeting]
```

- Remove any empty section.
- Do not end with a list of missing metadata or source limitations.
- Keep a factual, concise, professional tone suitable for sharing with stakeholders.
