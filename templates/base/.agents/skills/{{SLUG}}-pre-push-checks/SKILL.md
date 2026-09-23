---
name: {{SLUG}}-pre-push-checks
description: Use before pushing, force-pushing, or marking a change ready for review in {{PROJECT}}, to select the smallest set of tests and gates that actually covers the outgoing change. Also covers history-rewriting pushes and what to verify after one. Not needed for local work that will not be pushed; the Evidence orders in AGENTS.md cover reporting checks there.
---

# Pre-push checks

Use this skill to run the right evidence once before a push. The goal is the smallest set of checks that would fail if your change regressed — not the whole suite.

Git hooks are deliberately narrow: the pre-commit hook runs the fast gates and a whitespace check. Continuous integration owns exhaustive coverage and the platform matrix. Do not reproduce CI locally.

## 1. Inspect the outgoing change

Confirm where you are:

```sh
git status --short --branch
git rev-parse --show-toplevel
```

Then scope the change against its base:

```sh
node scripts/gates/change-scope.mjs --base <verified-base-ref>
```

The command never guesses or fetches a base — verify the ref from the remote or the pull request first. It reports committed paths relative to the merge base, plus staged, unstaged, and untracked paths for the current worktree.

After merging a changed base, run it again: the combined scope can reach further than either side alone.

## 2. Select evidence by surface

There is no universal local baseline. Every behavior change needs the narrowest check that would fail for its regression; broaden only for surfaces the change genuinely reaches.

| The change touches | Run |
|---|---|
| One module's behavior | That module's test file, or a focused test name |
| A contract shared across modules | The owning module's tests plus each consumer's tests |
| Documentation, decision records, or configuration catalogs | The documentation gates |
| Anything a user, editor, agent, or terminal sees | The focused test that owns that output |
| Manifests, public exports, build configuration, packaging | The build, plus the packaging smoke |
| Real external provider behavior | The end-to-end target for that provider, if credentials are available |
| Test infrastructure itself | The tests that use it, run together, not one at a time |

If you cannot name the check that would fail for your regression, you have not finished the change.

**Do not re-run a check that already passed** merely because a commit or push follows; the pre-commit hook already re-runs the fast gates on every commit.

## 3. Read failures honestly

If a relevant check fails before pushing, stop and fix it or explain the blocker. Do not push and hope CI disagrees.

If a failure looks environment-specific, prove it before dismissing it:

- Record the exact command, the failing test, and the mismatch.
- Confirm the non-platform-specific evidence still passes.
- Prefer fixing the nondeterminism over working around it.

Bypass a hook only when the user explicitly asks or agrees, and then report exactly what failed and why CI is expected to differ.

Never make a check pass by lowering a threshold, adding a skip, widening an ignore list, or narrowing a scope to exclude a file the change actually affects. A red check is a fact about the change.

## 4. Push

1. Run the selected checks once.
2. Commit normally, and inspect any file the pre-commit hook rewrote before continuing.
3. Push.
4. Confirm the remote ref matches local `HEAD`:

```sh
git rev-parse HEAD origin/$(git branch --show-current)
```

Report pending status as pending. Never describe an unverified push as passing.

## 5. History-rewriting pushes

A rebase is fine on a branch nobody else has checked out. Protect it anyway: fetch the current remote branch, record its exact object ID, and publish with a lease:

```sh
git push --force-with-lease=<branch>:<observed-oid>
```

A raw `--force` is never acceptable — it will silently discard a concurrent update.

After any rewritten push, the evidence from before the rewrite is void. Fetch the new heads and re-check what the branch actually contains: test results, review threads, approvals, and mergeability are all anchored to the old commits.

## 6. When a push shows no checks at all

If the hosting service reports no checks for a commit you just pushed, read the change's mergeability before suspecting the push:

```sh
git merge-tree --write-tree HEAD origin/<base>
```

Many hosts create no pull-request workflow runs while a change is in conflict. The absent signal is the conflict, not broken infrastructure. Resolving it is the only fix — an empty commit, a draft toggle, or a revert-and-restore bounce adds noise and changes nothing.

## Reporting

Report the commands you actually ran and their actual results. If something failed, say so with the output. If you skipped a check the change warranted, say that too and why.
