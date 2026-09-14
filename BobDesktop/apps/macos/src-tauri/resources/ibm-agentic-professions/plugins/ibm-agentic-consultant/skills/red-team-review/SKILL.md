---
name: red-team-review
description: "Challenge a recommendation before exposure to the client or decision-maker."
icon: consultant
---

# red-team-review

Use this skill to challenge a recommendation before exposure to the client or decision-maker.

## Required inputs

- goal or expected decision;
- scope, audience, deadline, and constraints;
- available sources, assumptions, and confidence level;
- output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly labeled assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Separate the team that defends from the team that attacks when possible.
2. Test logic, evidence, bias, adversarial scenarios, feasibility, and incentives.
3. Search for counterexamples and conditions that reverse the decision.
4. Classify objections, response, correction, owner, and final decision.

## Deliverable

Red Team log, critical weaknesses, corrections, and readiness verdict.

Always include: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps when applicable.

## Quality checks

- The review is not limited to style.
- Unresolved objections remain visible.
- The verdict and accepted risks are explicit.
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
