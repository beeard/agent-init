# Decision Record: A staged run stays within the corpus

Status: implemented

## Problem

`stagedSubset` documents the contract — a staged run is a subset of the whole-repository corpus, never a wider set — and `verify-final-newline` and `verify-issue-tags` follow it. Four gates did not: `verify-md-wrap`, `verify-python-docstrings`, `verify-go-docstrings`, and `verify-typescript-doc-comments` each listed the staged files themselves and filtered only by extension or skip directory. A staged file outside the configured globs was therefore judged by the commit hook and ignored by the full suite. Reproduced with `pythonGlobs` narrowed to `src/**/*.py`: the full run checked `0 file(s)`, while `--staged` reported an undocumented `other/foo.py`. The failure lands on the author at commit time, over a file no rule was pointed at, and the only remedies are editing a file the gate does not own or bypassing the hook.

## Decision

All four gates build the corpus first and intersect it with the staged paths through `stagedSubset`. The full run and the commit run now differ only in how much of the corpus they cover, never in what the corpus is.

## Alternatives considered

**Judge every staged file of the right extension.** The simpler rule, and the previous behavior. Rejected because `--staged` would then be stricter than the suite it is a subset of, and a rule a file cannot satisfy has no remedy but skipping the gate entirely, which costs it every future run.

**Drop `--staged` from these gates and scan the corpus on every commit.** Removes the divergence by removing the optimization. Rejected because it slows the hook on exactly the repositories large enough to need it, which is why the flag exists.

## Consequences

A pre-commit run can no longer report a finding the full suite does not, so a green hook and a green suite cannot disagree about the same tree. The staged subset is now derived from the corpus rather than from Git alone, so a gate's configuration is the single answer to what it judges.

## Related

The subset rule itself is stated in the shared library, `templates/base/scripts/gates/lib/repo-files.mjs`.
