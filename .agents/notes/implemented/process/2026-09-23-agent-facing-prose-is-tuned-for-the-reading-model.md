# Decision Record: Agent-facing prose is tuned for the reading model

Status: implemented

## Problem

Everything agent-init ships in `AGENTS.md`, the skills, and the subtree orders is read by a model, and a current model follows written instructions closely and literally. Text that was harmless to an older reader now changes behavior: a skill description that matches "any prose" or "claiming checks pass" loads on nearly every task, two wordings of one rule make the reader reconcile them, strategy coaching is applied where it does not fit, and a factual error in a procedure is followed exactly. The receiving repository inherits each of these, so a defect in the templates is a defect in every repository set up with them.

## Decision

The shipped and in-repository agent prose was audited against the dated-pattern catalogue for Claude Opus 5.5 as the reading model, and edited where a line matched a named pattern:

- **Skill descriptions state when not to load, as well as when to.** `prose-standard` fires when prose is the substance of the change and not for a routine commit message or short comment; `pre-push-checks` fires before a push or a ready-for-review mark, not whenever checks are reported; `agent-notes` and `code-review` name their non-triggers; the setup skill drops its keyword list for intent categories and excludes editing an already-adopted repository. The skill table in the base orders matches the descriptions.
- **One wording per rule.** Near-duplicates in the base orders are merged (smallest change and current consumer; published-history rewrites), and a stack or architecture line that restated a base rule is removed or reduced to its language-specific part, as the layer rule requires.
- **Duplicates that disagreed are reconciled.** "Do not default to the full suite" and "run the full suite before a push" now say test suite and gate suite respectively; "say so and stop" beside "a red check is fixed" becomes fix or report as a blocker.
- **Procedures that are judgment are stated as outcome and check.** The five-step passage rewrite in `prose-standard` becomes one classification rule and one verification.
- **Strategy asides and restated reasons are cut** where the gate or the tag definition already carries the rule.
- **Factual errors are corrected.** The pre-push skill cited a pre-push hook that is not shipped; the setup skill placed the coordinate file inside the skill directory rather than beside it; the external-agent prompt named a tarball version the package no longer has.

Kept deliberately: every rule a gate enforces, every "never" rule and its reason, the exact command sequences for pushes, leases, and setup ordering, the calibrated `**only**` on `--with-architecture`, and the "If you find nothing, say so" and "do not manufacture comments" lines, which counter over-reporting on the target model rather than prompting for more.

## Alternatives considered

**Leave the prose alone because it carries no shouting.** The surface has no capitalized pressure language, and a clean surface is a valid audit outcome. Rejected because the findings that remained are not register: over-broad triggers, disagreeing duplicates, and wrong facts all change what an agent does.

**Shorten every file toward a target length.** Rejected because length is not the defect; the removals here are each tied to a pattern, and context and reasons were kept even where cutting them would have saved words.

**Carry a model name or version in the templates.** Rejected because a pinned model name rots at the next release; the record names the model the audit targeted, and the prose itself stays model-neutral so the next audit starts from current rules only.

## Consequences

The base skills load on fewer unrelated tasks, and a receiving agent meets each rule once. The stack layers no longer restate base rules, so a later base change cannot leave a stale copy behind. The cost is that trigger boundaries are now judgment calls written in prose, tuned by reading rather than by a trigger evaluation; a skill that under-triggers after this change is the signal to widen its description again. The prose is tuned to one model generation and is due for the same audit at the next.

## Related

The setup skill's lookup order is decided in [The skill finds itself on any machine](../bug-fix/2026-09-17-the-skill-finds-itself-on-any-machine.md), whose placement sentence is corrected rather than replaced. The pinned tarball name is a cost recorded in [External agents get a self-contained prompt](../feature/2026-09-17-external-agents-get-a-self-contained-prompt.md).
