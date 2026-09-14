---
name: design-review
description: "Conduct a factual design review before build or release."
icon: designer
---

# design-review

Use this skill to conduct a factual design review before build or release.

## Minimum inputs

- expected objective or decision;
- scope, audience, deadline, and constraints;
- available sources, assumptions, and confidence level;
- output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly marked assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Set scope, scenario, criteria, and expected maturity.
2. Replay critical journeys and edge cases.
3. Check consistency, content, accessibility, feasibility, and measurement.
4. Classify findings by severity, evidence, owner, and deadline.

## Deliverable

Review report with verdict, prioritized anomalies, and actions.

Always include when applicable: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps.

## Quality checks

- Each finding is reproducible.
- Blockers are distinguished from improvements.
- The go, conditional go, or no-go decision is explicit.
- Clearly distinguish fact, estimate, assumption, and recommendation.
- Never invent data, client references, compliance claims, or validations.
- For information that may have changed, verify a current primary source and note the consultation date.

## Resources

See `../../references/sources.md` for official sources and `../../references/deliverable-contract.md` for the common delivery protocol. Proprietary frameworks cited serve as reference points: do not reproduce their protected materials.

## Language

- This skill file is authored in English.
- Deliverables must be written in the same language as the user's prompt unless the design system specifies fixed locale strings.
- Never mix languages in a single deliverable unless the user explicitly requests bilingual output.
