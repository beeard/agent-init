# Decision Record: The dogfood run exercises every gate

Status: implemented

## Problem

`scripts/check.mjs` applied every layer combination through the real scaffolder and then ran seven base gate modules it imported directly. No stack gate was ever imported, so `verify-go-docstrings`, `verify-python-docstrings`, `verify-rust-doc-comments`, and `verify-typescript-doc-comments` were never executed by the check that claims to run the shipped gates on the result — a stack gate could be deleted or broken and every group still passed.

Two smaller silent passes sat beside it. `verify-md-wrap` and `verify-md-links` have no built-in corpus floor, so a configuration that selected no files printed `ok … 0 file(s)` and the check counted it as green. And the composed skill list was a hand-written copy of `BASE_SKILLS` that could go stale without a failure.

The library agreed with the last one: `buildPlan` refused a declared layer with no templates but accepted a skill name that matched none, planning nothing and recording the name in the manifest.

## Decision

The check proves the artifact a receiving repository gets:

- Each composed scaffold runs its own `scripts/gates/run.mjs --group full`, so every gate in the composed inventory starts. Stack gates ship advisory, so a missing toolchain reports without failing and the check stays portable.
- A file-reading gate that judges an empty corpus is reported as a failure rather than printed as a clean run.
- `composeScaffold` imports `BASE_SKILLS`, and `buildPlan` refuses a skill name no template provides. The CLI refuses an empty `--skills` value on the same reasoning.

## Alternatives considered

**Import the stack gate modules into `check.mjs` as well.** Would keep the structured per-gate output. Rejected because it restates the composed `gates.json` by hand and drifts from it; running the shipped runner is what tests the artifact.

**Require a toolchain for the check.** Would make a broken analysis fail rather than warn. Rejected because the check must run where go, cargo, and TypeScript are absent, and the stack negative controls already prove the analysis where the toolchain is present.

**Leave a zero-file corpus as a pass.** Rejected because a gate that checked nothing has not run, and this repository's own rule is that a clean run it did not perform is worse than a failure.

## Consequences

A broken or missing gate now fails the check that exists to catch it, and a configuration that narrows a corpus to nothing fails instead of passing quietly. The check spawns a child per composed scaffold, so it is slower by roughly one suite per combination.

The trade is that a stack gate whose analysis is wrong while its process exits zero still passes here. That remains the stack tests' job, and the TypeScript gate's analysis is exercised only for its missing-toolchain path because this package ships no compiler.

## Related

Which combinations the matrix covers is in [Layer stack profiles as additive overlays](../architecture/2026-09-15-layer-stack-profiles-as-overlays.md).
