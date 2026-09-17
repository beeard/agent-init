# Decision Record: Corrections from reviewing the TypeScript change

Status: implemented

## Problem

An external review of the previous commit found four medium and nine low issues. Three were paths where a gate or a report would tell a user something untrue.

`applyPackage` assigned `devDependencies` unconditionally, so a run that contributed only scripts wrote `"devDependencies": {}` into a `package.json` it was otherwise only extending add-only; a Go-stack scaffold over such a file reproduced it. `verify-typescript-types` fell back to a corpus of `['**/*.ts', '**/*.tsx']` when the config did not declare `typescriptGlobs`, so a project holding only `.mts` or `.cts` sources hit the zero-file early return and printed "0 file(s) checked, the project type-checks" without ever spawning `tsc` — a clean run it did not perform, which is the failure that gate exists to prevent. The same gate never inspected `result.error`, so a killed or unspawnable compiler was reported as a type error with the status `null`.

The rest were smaller: `runComposedSuite` dropped `result.error` and set no timeout or buffer, so a spawn failure was reported as a failing suite with no explanation and a hang would block the check; the empty-corpus guard was written inline per gate while the `corpus`/`count` fields that were meant to drive it were never read; the config comparison used `toJson`, which is order-sensitive, so a `lib` list with the same members in another order read as a conflict; `installHook` read `.githooks/pre-commit` without allowing for a directory or an unreadable path; `stripJsonComments` carried two copies of its comment scanner; a comment in `verify-md-wrap` still claimed the staged run was size-independent after it began walking the whole corpus; and three tests re-typed a Git-isolation environment object that the same change had already given a named helper, while `install-local.test.mjs` carried an unused `globalValue` from before this work.

## Decision

Each finding is fixed in the place that owns it:

- `applyPackage` writes `devDependencies` only when it has an entry to contribute, and `applyPlan` treats `plan.package` as the non-null object it always is.
- `verify-typescript-types` aligns its fallback corpus with the configured default and reports a spawn failure or a kill signal through its `fatal` channel instead of as a type error.
- `runComposedSuite` names a spawn failure or a terminating signal, and carries a timeout and a 64 MB buffer; the empty-corpus failure is produced by a `gate()` helper from each entry's own `count` and `corpus` fields, so a new file-reading gate is covered by marking it rather than by remembering a second call.
- The TypeScript comparison canonicalises a value before comparing it, sorting object keys and array members.
- `installHook` reports a `.githooks/pre-commit` it cannot read as a regular file and installs nothing over it.
- `stripJsonComments` has one `skipComment` scanner, used by trivia skipping and the main loop.
- The `verify-md-wrap` comment states what the staged run does: it analyses only the staged documents, without promising that enumeration is free.
- `tests/helpers.mjs` exports `gitConfigEnv(configPath, extra)`, and the three environment literals, the installer's `sandboxEnv`, and the commit-creating `change-scope` helper all go through it. The unused `globalValue` is deleted.

## Alternatives considered

**Fix only the four medium findings.** Would leave the check able to hang, the config report able to recommend a no-op change, and the tests able to break on a developer's global `commit.gpgsign`. Rejected because those are the same class of defect — a report or a check that does not mean what it says — and the fix for each is a few lines.

**Rewrite `verify-typescript-types` to check `strict` itself instead of trusting the config report.** Would catch a non-strict config at gate time. Rejected because `tsc` already enforces whatever the config says, and the init-time report is where a repository is told what its config does not set; duplicating the rule in the gate would give two homes for one fact.

**Delete the `corpus`/`count` fields and keep the inline guard.** The smaller change, and what the reviewer offered as the alternative. Rejected because the marker is what makes a future file-reading gate covered; removing it leaves the guard to be remembered.

**Leave the dead `globalValue` helper for a future test.** Rejected because it carried the sandbox-environment rationale that now lives in one shared helper, and an unused copy is a place for that rationale to drift.

## Consequences

The typecheck gate can no longer report a clean run over only `.mts`/`.cts` sources, and no longer presents a broken compiler as a type failure. The dogfood check can no longer hang without a bound or report a failed suite with an empty explanation.

The review closed with no critical or high findings; these are corrections to the change under review rather than to the product's design. Two behaviours are now pinned by tests that did not exist: a scripts-only package.json contribution must not add an empty `devDependencies`, and the silent-config fallback must cover `.mts`/`.cts`.

## Related

The initialisation this review examined is in [TypeScript projects are initialised, not just annotated](../feature/2026-09-17-typescript-projects-are-initialised.md), and the composition form it added is in [Base orders compose with an existing AGENTS.md](../architecture/2026-09-17-base-orders-compose-with-an-existing-agents-md.md).
