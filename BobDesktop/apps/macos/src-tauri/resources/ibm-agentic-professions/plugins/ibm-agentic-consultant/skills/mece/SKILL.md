---
name: mece
description: "Break down a question without material overlap or a major blind spot."
icon: consultant
---

# MECE

Use this skill to break down a question without material overlap or a major blind spot.

## Required inputs

- goal or expected decision;
- scope, audience, deadline, and constraints;
- available sources, assumptions, and confidence level;
- output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly labeled assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Choose a single decomposition logic at the current level.
2. Test mutual exclusivity and collective exhaustiveness.
3. Add a residual category only if it is genuinely useful.
4. Stop decomposing when branches become analyzable.

## Deliverable

Annotated MECE decomposition with logic, tests, and limits.

Always include: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps when applicable.

## Quality checks

- No mixing of causes, solutions, and metrics at the same level.
- Every item has a unique place.
- Possible omissions are stated explicitly.
- Distinguish clearly between fact, estimate, assumption, and recommendation.
- Never invent data, client references, compliance claims, or validation.
- For information that may have changed, verify a current primary source and note the consultation date.

## Language

- Write the skill file in English.
- Write the entire output in the same language as the user's prompt.
- When ambiguous, use the prompt's main request sentence language.
- Never mix languages unless user requests bilingual output.
- Keep official framework names; add brief translation in parentheses when helpful.

## References

See ../../references/sources.md for official sources and ../../references/deliverable-contract.md for the shared deliverable contract. Proprietary frameworks cited serve as references; do not reproduce protected materials.
