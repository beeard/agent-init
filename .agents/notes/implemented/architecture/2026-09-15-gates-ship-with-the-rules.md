# Decision Record: Ship the gates with the rules

Status: implemented

## Problem

A structure of written rules for agents decays unless something checks it. A document can state one convention while the code follows another, and the cost lands on whoever trusts the document next.

The structure this package writes is entirely documents: standing orders, decision records, a documentation standard. Documents are exactly the kind of artifact that rots invisibly.

## Decision

Every rule the package ships is accompanied by the check that enforces it, and both are copied into the receiving repository as source it owns.

`verify-md-wrap` enforces one physical line per paragraph. `verify-agent-note-tree` and `verify-agent-note-format` enforce where a decision record lives and what it contains. `verify-doc-budgets` enforces the ceilings the documentation standard states. `verify-md-links` keeps relative references honest.

The gates live at `scripts/gates/` in the receiving repository. They run through `node scripts/gates/run.mjs`, the pre-commit hook runs the `fast` subset, and nothing in them refers back to this package.

This repository runs the same gates against its own templates under `npm run check`, with the templates' own budgets in the manifest, so a template that would fail in a receiving repository fails here first.

## Alternatives considered

**Run the gates from the installed package instead of copying them.** The receiving repository would gain automatic improvements and lose the ability to change a rule that does not fit it. More decisively, its checks would break whenever this package was absent, uninstalled, or never installed — for instance in CI, which has no reason to know this tool exists. Rejected because a repository whose rules stop working when an unrelated package changes is not a repository that owns its rules.

**Ship the rules as prose only, with no gates.** Cheaper to build and to maintain, and it avoids the false precision of a check that models only part of the problem. Rejected because prose-only rules are the failure mode the package exists to prevent: the drift is silent, and the first evidence of it is an agent confidently following a rule that no longer matches the code.

**Use a real Markdown parser for the paragraph and link checks.** An abstract syntax tree would model list nesting and reference definitions correctly, and would not misread the edge cases the line-oriented scanner documents as unsupported. Rejected because it requires a runtime dependency, and the tool that scaffolds a fresh checkout cannot demand an install before it runs. The scanner states what it does not model rather than pretending to completeness.

**Generate the gates into the repository from templates at build time.** Would avoid storing two copies of each gate in the repository (the template and the generated file) and keep them provably identical. Rejected because it adds a build step to a tool whose value is that it runs with nothing but Node, and because the repository is meant to edit what it receives.

## Consequences

A receiving repository gets working checks on day one, and can read the rule and its enforcement side by side. The first `run.mjs` after scaffolding passes, because the templates are checked against the same gates before they ship.

The cost is duplication of a different kind: improvements to a gate do not reach repositories that already adopted it. An upgraded gate must be copied deliberately, and nothing detects that a repository is running an old one. That is the price of repositories owning their own rules, and it is accepted knowingly.

A second cost is that the gates are only as good as their negative controls. A check that never rejects anything is indistinguishable from a passing one, so `tests/gates.test.mjs` breaks one thing per gate and asserts the rejection.
