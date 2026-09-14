---
name: proposal-review
description: "Run progressive reviews then a Red Team before submission."
icon: rfp
---

# proposal-review

Use this skill to run progressive reviews then a Red Team before submission.

## Required inputs

- goal or expected decision;
- scope, audience, deadline, and constraints;
- available sources, assumptions, and confidence level;
- output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly marked assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Plan reviews for strategy, content, solution, commercial, compliance, and production.
2. Evaluate against client criteria, not internal preferences.
3. Track comments, severity, owner, deadline, and resolution.
4. Perform an independent final check of the submitted package.

## Deliverable

Review log, simulated score, corrections, submission checklist, and verdict.

Always include: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps when applicable.

## Quality checks

- All documents and addenda are present.
- Blockers are closed or formally accepted.
- Final file is revalidated after packaging.
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
