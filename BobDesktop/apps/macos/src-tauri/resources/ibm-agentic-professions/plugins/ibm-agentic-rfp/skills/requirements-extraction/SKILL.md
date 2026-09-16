---
name: requirements-extraction
description: "Extract atomic, testable, and traceable requirements."
icon: rfp
---

# requirements-extraction

Use this skill to extract atomic, testable, and traceable requirements.

## Required inputs

- goal or expected decision;
- scope, audience, deadline, and constraints;
- available sources, assumptions, and confidence level;
- output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly marked assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Review the full corpus, including tables, annexes, and forms.
2. Split compound sentences into atomic obligations.
3. Classify as mandatory, evaluated, informational, contractual, or ambiguous.
4. Assign a stable identifier, exact source, owner, and expected evidence.

## Deliverable

Atomic requirements register with source traceability.

Always include: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps when applicable.

## Quality checks

- Completeness verified by a second pass.
- Terms such as shall/must and equivalents are preserved.
- Duplicates remain linked to all their sources.
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
