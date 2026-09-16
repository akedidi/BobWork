---
name: prd
description: "Specify the why, what, and how to measure without over-designing the how."
icon: product
---

# PRD

Use this skill to specify the why, what, and how to measure without over-designing the how.

## Required inputs

- Expected goal or decision;
- Scope, audience, deadline, and constraints;
- Available sources, assumptions, and confidence level;
- Output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly labeled assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Describe context, problem, users, goal, and non-goals.
2. Document requirements, flows, rules, data, errors, and edge cases.
3. Include NFRs, analytics, rollout, dependencies, risks, and open questions.
4. Define acceptance criteria and success before building.

## Deliverable

Versioned PRD with decisions, requirements, and measurement plan.

Always include when applicable: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps.

## Quality checks

- Requirements are testable.
- Non-goals prevent implicit scope expansion.
- Open questions have owners and dates.
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
