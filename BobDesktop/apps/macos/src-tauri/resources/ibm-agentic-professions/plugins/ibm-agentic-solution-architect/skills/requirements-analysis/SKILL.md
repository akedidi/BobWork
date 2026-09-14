---
name: requirements-analysis
description: "Transform needs into traceable functional requirements."
icon: architecture
---

# requirements-analysis

Use this skill to transform needs into traceable functional requirements.

## Required inputs

- goal or expected decision;
- scope, audience, deadline, and constraints;
- available sources, assumptions, and confidence level;
- output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly marked assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Identify actors, capabilities, events, data, and rules.
2. Distinguish need, requirement, constraint, assumption, and proposed solution.
3. Make requirements atomic and testable.
4. Maintain traceability to objectives, scenarios, and decisions.

## Deliverable

FR catalog, context, use cases, and traceability matrix.

Always include: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps when applicable.

## Quality checks

- No requirement without a source.
- Ambiguities become open questions.
- Conflicts have an explicit decision.
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
