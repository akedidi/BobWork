---
name: cost-analysis
description: "Estimate and optimize total cost without compromising drivers."
icon: architecture
---

# cost-analysis

Use this skill to estimate and optimize total cost without compromising drivers.

## Required inputs

- goal or expected decision;
- scope, audience, deadline, and constraints;
- available sources, assumptions, and confidence level;
- output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly marked assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Define demand units and load assumptions.
2. Model compute, storage, network, licenses, support, and operations.
3. Compare growth scenarios and commitments.
4. Define allocation, budgets, alerts, and FinOps levers.

## Deliverable

Cost model, assumptions, sensitivities, and optimization plan.

Always include: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps when applicable.

## Quality checks

- Rates and currencies dated and sourced.
- Include migration and operational costs.
- Optimization does not violate SLOs or security.
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
