---
name: design-system
description: "Govern components, tokens, and patterns as a shared product."
icon: designer
---

# design-system

Use this skill to govern components, tokens, and patterns as a shared product.

## Minimum inputs

- expected objective or decision;
- scope, audience, deadline, and constraints;
- available sources, assumptions, and confidence level;
- output format and acceptance criteria.

Do not block on secondary information: proceed with an explicitly marked assumption. Ask for clarification when the assumption would materially change the decision, risk, or scope.

## Method

1. Audit the existing system and identify duplicates or gaps.
2. Define semantic tokens, anatomy, variants, properties, and behaviors.
3. Document usage, non-usage, accessibility, and examples.
4. Prepare contribution, versioning, deprecation, and adoption measurement.

## Deliverable

Component specification, tokens, documentation, and governance plan.

Always include when applicable: decision summary, facts and sources, assumptions, limits, actions, owners, and next validation steps.

## Quality checks

- Stable, minimal component API.
- Design and code share the same names.
- Accessibility and migration are documented.
- Clearly distinguish fact, estimate, assumption, and recommendation.
- Never invent data, client references, compliance claims, or validations.
- For information that may have changed, verify a current primary source and note the consultation date.

## Resources

See `../../references/sources.md` for official sources and `../../references/deliverable-contract.md` for the common delivery protocol. Proprietary frameworks cited serve as reference points: do not reproduce their protected materials.

## Language

- This skill file is authored in English.
- Deliverables must be written in the same language as the user's prompt unless the design system specifies fixed locale strings.
- Never mix languages in a single deliverable unless the user explicitly requests bilingual output.
