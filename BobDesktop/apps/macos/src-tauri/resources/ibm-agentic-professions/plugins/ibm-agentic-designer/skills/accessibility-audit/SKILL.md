---
name: accessibility-audit
description: "Audit accessibility against WCAG 2.2 and applicable IBM/Carbon criteria."
icon: designer
---

# accessibility-audit

Use this skill to audit accessibility against WCAG 2.2 and applicable IBM/Carbon criteria.

## Minimum inputs

- expected objective or decision;
- scope, audience, deadline, and constraints;
- available sources, assumptions, and confidence level;
- output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly marked assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Define target level, platforms, technologies, and sample.
2. Test keyboard, focus, zoom, contrast, structure, accessible names, errors, and media.
3. Combine automated checks and manual verification with assistive technologies.
4. Map each anomaly to a criterion, evidence, and testable fix.

## Deliverable

WCAG report with criterion, level, severity, evidence, fix, and re-test.

Always include when applicable: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps.

## Quality checks

- Never conclude compliance from automation alone.
- Include reproduction steps and expected result.
- Protect participants' personal data.
- Clearly distinguish fact, estimate, assumption, and recommendation.
- Never invent data, client references, compliance claims, or validations.
- For information that may have changed, verify a current primary source and note the consultation date.

## Resources

See `../../references/sources.md` for official sources and `../../references/deliverable-contract.md` for the common delivery protocol. Proprietary frameworks cited serve as reference points: do not reproduce their protected materials.

## Language

- This skill file is authored in English.
- Deliverables must be written in the same language as the user's prompt unless the design system specifies fixed locale strings.
- Never mix languages in a single deliverable unless the user explicitly requests bilingual output.
