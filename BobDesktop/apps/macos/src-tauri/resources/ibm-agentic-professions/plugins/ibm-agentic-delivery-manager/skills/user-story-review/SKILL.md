---
name: user-story-review
description: "Verify a story is understood and testable before commitment."
icon: delivery
---

# user-story-review

Use this skill to verify a story is understood and testable before commitment.

## Required inputs

- Expected goal or decision;
- Scope, audience, deadline, and constraints;
- Available sources, assumptions, and confidence level;
- Output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly labeled assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Verify value, actor, scenario, and outcome.
2. Examine criteria, examples, errors, accessibility, and NFRs.
3. Detect dependencies, ambiguities, and splitting needs.
4. Confirm shared agreement on ready and done.

## Deliverable

Review checklist, open questions, and splitting recommendations.

Always include when applicable: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps.

## Quality checks

- Criteria are observable.
- Dependencies are named.
- A story that is not ready is not forced into the sprint.
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
