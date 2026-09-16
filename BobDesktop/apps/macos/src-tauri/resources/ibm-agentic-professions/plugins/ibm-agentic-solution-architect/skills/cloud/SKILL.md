---
name: cloud
description: "Choose and structure cloud services according to drivers and guardrails."
icon: architecture
---

# cloud

Use this skill to choose and structure cloud services according to drivers and guardrails.

## Required inputs

- goal or expected decision;
- scope, audience, deadline, and constraints;
- available sources, assumptions, and confidence level;
- output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly marked assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Confirm responsibility model, regions, constraints, and skills.
2. Compare managed services, portability, dependency, and operability.
3. Design accounts/subscriptions, network, identity, data, and observability.
4. Verify capacity, limits, and pricing in current provider sources.

## Deliverable

Landing-zone view, service map, cloud decisions, and guardrails.

Always include: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps when applicable.

## Quality checks

- No service assumed available without recent verification.
- Regional limits and quotas are considered.
- Choice minimizes total operational burden.
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
