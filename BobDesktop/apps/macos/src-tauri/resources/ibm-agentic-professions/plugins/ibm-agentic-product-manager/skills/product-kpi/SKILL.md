---
name: product-kpi
description: "Define an actionable metric system resistant to perverse effects."
icon: product
---

# product-kpi

Use this skill to define an actionable metric system resistant to perverse effects.

## Required inputs

- Expected goal or decision;
- Scope, audience, deadline, and constraints;
- Available sources, assumptions, and confidence level;
- Output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly labeled assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Link North Star, inputs, outputs, and guardrails to the value model.
2. Define formula, population, window, source, frequency, and owner.
3. Segment to detect misleading averages.
4. Set baseline, target, alert threshold, and associated decision.

## Deliverable

Metric tree and KPI dictionary with governance.

Always include when applicable: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps.

## Quality checks

- Each KPI has a calculable definition.
- Leading and lagging indicators are balanced.
- Guardrails limit local optimization.
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
