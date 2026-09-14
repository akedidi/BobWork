---
name: dependency-analysis
description: "Identify and reduce dependencies that threaten flow."
icon: delivery
---

# dependency-analysis

Use this skill to identify and reduce dependencies that threaten flow.

## Required inputs

- Expected goal or decision;
- Scope, audience, deadline, and constraints;
- Available sources, assumptions, and confidence level;
- Output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly labeled assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Map supplier, consumer, object, date, and criticality.
2. Distinguish technical, team, decision, environment, and vendor dependencies.
3. Choose to eliminate, decouple, advance, synchronize, or escalate.
4. Track early signals and owner until closure.

## Deliverable

Dependency map, critical path, and mitigation actions.

Always include when applicable: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps.

## Quality checks

- Each dependency has two owners.
- The required date is explicit.
- Critical dependencies appear in the sprint or release plan.
- Distinguish clearly between fact, estimate, assumption, and recommendation.
- Never invent data, a client reference, a compliance claim, or an approval.
- For information that may have changed, verify a current primary source and note the consultation date.

## Language

- Write the **skill file** in English.
- Write the **entire output** in the same language as the user's prompt (the message that invoked this skill), including titles, section headings, labels, and table headers.
- When the prompt language is ambiguous, use the language of the prompt's main request sentence.
- Never mix languages in a single deliverable unless the user explicitly requests bilingual output.
- Keep official framework and product names; add a brief translation in parentheses when helpful.

## References

See `../../references/sources.md` for official sources and `../../references/deliverable-contract.md` for the shared delivery protocol. Proprietary frameworks cited serve as reference points only — do not reproduce their protected materials.
