# Decision Record: The commit group judges the index

Status: implemented

## Problem

The pre-commit hook runs `node scripts/gates/run.mjs --group commit`, and every gate in that group received `--staged`. The flag chose which files to judge from `git diff --cached`, but each gate then read those files from the working tree. A violation that was staged and then fixed only in the working copy passed the hook and was committed; a clean staged file that was broken afterwards in the working copy failed it. The stack gates had the same defect in a form no per-gate fix could reach: they hand paths to Python, Go, or the TypeScript compiler, which read the working tree themselves.

The runner had two smaller faults beside it. `spawnSync` ran each gate with the default one-megabyte output buffer, so a passing gate with a long report was killed with `ENOBUFS` and reported as a failure. And that error branch counted a failure without consulting `advisory`, so an advisory gate that could not run to completion failed the suite, which is the one thing advisory promises it will not do.

## Decision

`run.mjs` materialises the index for the `commit` group. `materialiseIndex` runs `git checkout-index --all` into a temporary directory, and every gate runs from that directory as its repository root, receiving `--staged` as before. The child environment sets `GIT_DIR` to the real repository and `GIT_WORK_TREE` to the temporary tree, so the unchanged `stagedSources` in `lib/repo-files.mjs`, and the Rust gate's own copy, still list the staged paths. A relative `GIT_INDEX_FILE`, which `git commit -a` and `git commit <paths>` hand to the hook, is made absolute so the temporary index is the one read. The tree is removed in a `finally` block.

Two things the index does not carry are taken from the working tree. A file under `scripts/gates/` that is not in the index is copied in, so the gates run before they are first committed; a gate file that is staged runs as staged. And a top-level directory named in `REPOSITORY_SKIP_DIRECTORIES` or a layer's `*SkipDirectories`, such as `node_modules`, is linked in when absent, because a gate resolves its toolchain from it. The corpus walker never enters a linked directory, so neither becomes content.

Each gate's output buffer is `MAX_GATE_OUTPUT`, 256 MiB. A gate is ok only when it exits zero with no spawn error; any other outcome is `WARN` for an advisory gate and `FAIL` otherwise, and the spawn error message is printed in place of the description. `runGates` takes an optional `maxBuffer` so the error branch has a negative control. When the index cannot be materialised, the runner exits 2 and says why rather than falling back to the working tree.

A gate invoked directly with `--staged` still restricts itself to the staged paths and reads the tree it is run in; the runner is what makes that tree the index.

## Alternatives considered

**Read each staged file with `git show :path` inside the gates.** Fixes the base gates one by one. Rejected because the stack gates pass paths to external toolchains that read the filesystem, so the defect would remain in every gate that delegates to a language's own tooling, which is the kind this package prefers.

**Stash the unstaged changes around the hook.** The approach several hook managers take. Rejected because it rewrites the author's working tree during a commit, and an interrupted hook or a conflicting stash loses work; a temporary tree touches nothing the author owns.

**Materialise only the staged files and read everything else from the working tree.** Cheaper on a large repository. Rejected because the tree-wide gates in the group, the decision-record layout and the link check, would then judge a mixture the commit never contains: a link to a file that exists only untracked would pass.

**Stream gate output instead of buffering it.** Removes the buffer limit entirely. Rejected because the runner prints a gate's last line on success and its whole report only on failure, which needs the output collected; a bound far above any readable report keeps that behavior.

## Consequences

The hook and the commit now agree: what the commit group passes is what `git commit` records, for the base gates and the stack gates alike, and the negative controls in `tests/gates.test.mjs` stage a violation, fix only the working copy, and assert the commit group and the real hook both reject it.

It costs a checkout of the whole index on every commit, which grows with the repository rather than with the change. The gates themselves still analyse only the staged subset, so the per-gate cost is unchanged; this partly revises the constant-time claim in [layer stack profiles as overlays](../architecture/2026-09-15-layer-stack-profiles-as-overlays.md). A commit group run over an index that lacks the decision-record tree now reports it missing, because the commit would lack it too, so the tests stage the scaffold before running the group. A gate with over 256 MiB of output is still cut off, and says so.

## Related

The staged subset itself is still the corpus intersected with the staged paths, as [a staged run stays within the corpus](2026-09-17-a-staged-run-stays-within-the-corpus.md) records.
