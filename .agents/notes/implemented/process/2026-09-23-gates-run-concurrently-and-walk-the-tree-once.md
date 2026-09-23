# Decision Record: Gates run concurrently and walk the tree once

Status: implemented

## Problem

The suite's cost grew with the repository in two places a change did not touch. `run.mjs` ran every gate with `spawnSync`, one after another, so the suite took the sum of its gates even on a machine with idle cores; a stack gate that starts a toolchain, such as `go run` or `cargo rustc`, held every gate after it. And `collectFiles` expanded each glob with its own walk of the tree, entering every directory before `corpusSkipPredicate` threw its files away. `verify-final-newline` expands thirteen `**/*` globs plus the configured ones, so a repository with a populated `node_modules` was listed in full more than a dozen times per run, only to have every file in it discarded.

Measured on a scaffolded repository with 20 000 source files and 30 000 files in `node_modules`, on four cores: `verify-final-newline` took 2.1 s, `verify-issue-tags` 1.6 s, and the full suite 4.6 s.

## Decision

`runGates` is asynchronous and runs up to `jobs` gates at once, defaulting to `os.availableParallelism()`. `run.mjs --jobs <n>` sets the bound, and anything but a positive whole number exits 2. Each gate's result is printed as soon as every gate before it in the manifest has been printed, so the report reads in manifest order however the gates are scheduled. A gate whose combined output passes `maxBuffer` is killed and reported with an error, as `spawnSync` did before, so the advisory rule for a gate that cannot run to completion is unchanged. The runner's header states the contract this adds for gate authors: a gate must not write where another gate reads.

`collectFiles` lists each directory once for all its patterns, through a listing cache shared by the expansions of one call, and `skipPredicate` does the same across its skip globs. The predicate `corpusSkipPredicate` returns carries its excluded directory names as `directories`, and `collectFiles` prunes those directories from the walk instead of filtering their files afterwards. The predicate rejects every file below such a directory, so the corpus is identical; a test asserts that equivalence and that the walk never lists a pruned directory. Every gate that already used `corpusSkipPredicate` gains the pruning without changing.

On the same repository, `verify-final-newline` takes 0.57 s, `verify-issue-tags` 0.48 s, and the full suite 0.7 s, against 1.8 s with `--jobs 1`.

## Alternatives considered

**Run the gates in one process instead of one child each.** Removes Node's start-up cost per gate. Rejected because the child process is what keeps one crashing gate from hiding the others' results, and what lets a repository add a gate without conforming to an in-process interface.

**Materialise only part of the index for the commit group.** The whole-index checkout is now the largest cost of a commit on a large repository. Rejected again for the reason [the commit group judges the index](../bug-fix/2026-09-23-the-commit-group-judges-the-index.md) gives: the link and layout gates would judge a tree the commit does not contain.

**Replace the per-pattern walk with one walk matching every pattern at each entry.** Saves the remaining in-memory traversal. Rejected for now because the listing cache already removes the repeated filesystem reads, which were the cost, and a combined matcher is a second glob implementation to keep in step with the first.

## Consequences

The suite takes roughly as long as its slowest gate rather than the sum of all of them, and the hook with it. Gates that compile the project, such as Rust's and TypeScript's type gate, can now run at the same time and compete for memory; `--jobs 1` restores the sequential run where that matters. Gate output is still collected in full before it is printed, so a slow gate delays the report of every gate after it, though not their execution.

A directory named by a skip list is no longer read at all, so a gate cannot see into it even through a pattern that names it explicitly — which is what the skip list already meant, since its files were discarded. The commit group still checks out the whole index, and on a very large repository that checkout is now most of the hook's time.
