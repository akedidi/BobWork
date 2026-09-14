---
name: release-planning
description: "Prepare a safe, observable, and reversible release."
icon: delivery
---

# release-planning

Use this skill to prepare a safe, observable, and reversible release.

## Required inputs

- Expected goal or decision;
- Scope, audience, deadline, and constraints;
- Available sources, assumptions, and confidence level;
- Output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly labeled assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Define scope, entry/exit criteria, dependencies, and window.
2. Coordinate testing, data, security, operations, support, and communication.
3. Design progressive rollout, monitoring, rollback, and responsibilities.
4. Execute go/no-go, then verify results and post-release incidents.

## Deliverable

Release plan, checklist, RACI, communication, rollback, and validation.

Always include when applicable: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps.

## Quality checks

- Rollback is tested or has a credible procedure.
- Metrics and alerts are ready before release.
- Go/no-go has objective criteria.
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
