---
name: rfp-analysis
description: "Analyze a complete RFP, RFQ, or RFT and its evaluation mechanism."
icon: rfp
---

# rfp-analysis

Use this skill to analyze a complete RFP, RFQ, or RFT and its evaluation mechanism.

## Required inputs

- goal or expected decision;
- scope, audience, deadline, and constraints;
- available sources, assumptions, and confidence level;
- output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly marked assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Identify documents, addenda, dates, clarification channel, and contractual hierarchy.
2. Extract objectives, scope, deliverables, criteria, clauses, and submission instructions.
3. Flag ambiguities, contradictions, dependencies, and contractual risks.
4. Produce a pursuit view with winning themes and open questions.

## Deliverable

Analysis dossier, timeline, evaluation criteria, risks, and questions.

Always include: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps when applicable.

## Quality checks

- Every finding cites document, section, and page.
- Addenda are incorporated.
- No assumption presented as a requirement.
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
