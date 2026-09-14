---
name: capacity-planning
description: "Calculate realistic capacity from availability and historical data."
icon: delivery
---

# capacity-planning

Use this skill to calculate realistic capacity from availability and historical data.

## Required inputs

- Expected goal or decision;
- Scope, audience, deadline, and constraints;
- Available sources, assumptions, and confidence level;
- Output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly labeled assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Collect working days, absences, support load, and skill constraints.
2. Use comparable historical throughput or velocity.
3. Reserve capacity for incidents, debt, and unplanned work.
4. Produce a central scenario and a prudent range.

## Deliverable

Team capacity plan, assumptions, buffers, and scenarios.

Always include when applicable: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps.

## Quality checks

- Availability does not equal productive capacity.
- Rare skills are explicit.
- Buffers are grounded in history.
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
