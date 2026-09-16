---
name: architecture-review
description: "Evaluate an architecture against requirements, drivers, and risks."
icon: architecture
---

# architecture-review

Use this skill to evaluate an architecture against requirements, drivers, and risks.

## Required inputs

- goal or expected decision;
- scope, audience, deadline, and constraints;
- available sources, assumptions, and confidence level;
- output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly marked assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Set scope, maturity, criteria, and expected evidence.
2. Replay functional, quality, security, failure, and operability scenarios.
3. Verify consistency of views, decisions, and roadmap.
4. Classify findings, risk, recommendation, owner, and deadline.

## Deliverable

Review report with verdict, risks, actions, and required decisions.

Always include: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps when applicable.

## Quality checks

- Findings cite evidence.
- Blockers separated from improvements.
- Verdict is conditioned on measurable criteria.
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
