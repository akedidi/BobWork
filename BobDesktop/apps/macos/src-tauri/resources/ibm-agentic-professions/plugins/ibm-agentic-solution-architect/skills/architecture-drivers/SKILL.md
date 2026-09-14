---
name: architecture-drivers
description: "Prioritize the forces that truly shape the architecture."
icon: architecture
---

# architecture-drivers

Use this skill to prioritize the forces that truly shape the architecture.

## Required inputs

- goal or expected decision;
- scope, audience, deadline, and constraints;
- available sources, assumptions, and confidence level;
- output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly marked assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Collect business objectives, critical NFRs, constraints, risks, and principles.
2. Assess impact, volatility, and discriminating power.
3. Retain a small set of dominant drivers.
4. Test each option against these drivers.

## Deliverable

Prioritized driver map with architectural implications.

Always include: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps when applicable.

## Quality checks

- Drivers are not a copy of all requirements.
- Conflicts are visible.
- Priority is validated by decision makers.
- Distinguish clearly between fact, estimate, assumption, and recommendation.
- Never invent data, client references, compliance claims, or validation.
- For information that may have changed, verify a current primary source and note the consultation date.

## Language

- Write the **skill file** in English.
- Write the **entire output** in the same language as the user's prompt (the message that invoked this skill), including titles, section headings, labels, and table headers.
- When the prompt language is ambiguous, use the language of the prompt's main request sentence.
- Never mix languages in a single deliverable unless the user explicitly requests bilingual output.
- Keep official framework and product names; add a brief translation in parentheses when helpful.

## References

See `../../references/sources.md` for official sources and `../../references/deliverable-contract.md` for the shared delivery protocol. Proprietary frameworks cited serve as reference points: do not reproduce their protected materials.
