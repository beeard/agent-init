# Decision Record: A re-run keeps what the repository owns

Status: implemented

## Problem

The scaffolder promises that re-running it is safe: existing files are kept unless `--force`. A review found ten ways the apply step broke that promise or reported something other than what it did.

- **The base orders were composed twice.** `.compose` recognised an adopted repository only by `.agents/manifest.json`. A fresh write carries no markers, so a re-run after the manifest was deleted — which the run's own `kept` message suggested — or after a run that failed before writing the manifest appended the whole base document a second time.
- **Dangling symlinks were written through.** `existsSync` follows links, so a dangling `CLAUDE.md -> ../outside/pwned.md` looked absent: the symlink call failed, the failure was reported as "this platform refused a link", and the `@`-import fallback created the file outside the repository. The hook, `package.json`, and every template write had the same hole, including through a linked parent directory.
- **Hand edits to merged manifests were reverted.** A re-run replaced every entry the template set, so a gate tightened to `"advisory": false`, as `--lenient` tells the user to do, went back to advisory on the next run.
- **The manifest forgot later layers.** A re-run with an added `--stack` kept the manifest as it was, so `layers` and `stack` no longer described the tree.
- **`--dry-run` misreported merges.** Each merge read the file on disk rather than the earlier layers' results, so a dry run reported `+ AGENTS.md` where the real run reported `+ go in AGENTS.md`, `added` where it would append, and could not see a shape conflict an earlier layer created.
- **The tool's own hook was foreign with CRLF endings**, and **`./.githooks` or an absolute path to the same directory was a foreign `core.hooksPath`**, because both were compared as strings.
- **`--skills all,bogus` passed**, because the list was replaced by every skill before it was validated.
- **`--install-skill` accepted a previous `--link` install as current**, because the copy check read `SKILL.md` through the link.
- **A merge target holding valid JSON that is not an object** — an array, say — was treated as `{}` and overwritten.

## Decision

**A run simulates before it writes.** `applyPlan` runs the whole file phase — templates, links, and the manifest — through a view. The first pass always uses a dry view, which keeps writes in an in-memory overlay and reads them back, so each layer sees the earlier layers' results. `--dry-run` reports that pass; a real run starts a second pass against the disk only after the first completed. Every refusal a merge raises therefore comes before the first write, and the CLI says `Nothing was written` for it.

**Compose recognises its own content.** A file without the layer's markers, in a repository without a manifest, is left alone when at least half of the template's substantive lines — twenty characters or more, after substitution — appear in it verbatim. A hand-edited copy keeps most of them, and a repository's own document shares almost none. The written form is unchanged: a fresh repository's `AGENTS.md` still carries no markers.

**Nothing is written through a symlink that dangles or leaves the repository.** Existence is tested with `lstat`, so a dangling link is present, not absent. Before any write, the path and its nearest existing ancestor are resolved; a dangling link, or a real path outside the repository's real path, refuses the write. A path that already exists, and that the run would not overwrite, is reported `kept` with the reason; one the run would have written is reported `refused`, and a note says how to clear it. A link failure is reported with its error code.

**Merges keep the repository's values without `--force`.** An entry the file held before this run started is the repository's. Without `--force`, its value is kept even where the template's differs, and only the entries it lacks are added. This applies at both levels the `.merge` contract reaches: a top-level key, and an entry inside a key that is an object on both sides. An entry below that level travels with its parent entry. Entries an earlier layer of the same run set are not the repository's, so a later layer still replaces them, which is what "every other key is replaced" in the contract describes. A kept difference is named in the report — `kept advisory in verify-go-docstrings.mjs as the file has them (--force to replace)` — and a merge whose only differences were kept reports `kept`. With `--force` the template's value wins as before. A file that is not valid JSON, or holds anything but an object, stops the run.

**The manifest records a union.** A present manifest keeps `adopted`, `version`, and `lenient`, and gains any layer, stack, or skill the run adds; `architecture` becomes true once any run applied it. Nothing a previous run recorded is removed, because its files are still there. The report names what was added.

**Hooks compare what they mean.** The tool's own hook is recognised with line endings normalised. `core.hooksPath` is ours when its value, resolved against the repository and through symlinks, is the same directory as `.githooks`.

**Every `--skills` entry is validated**, `all` beside it included.

**A copy install replaces a link.** A symlink at the skill's destination is removed without a backup, since renaming a link moves only the path it holds, and a copy takes its place, reported `replaced`.

## Alternatives considered

**Wrap a fresh compose write in the layer's markers.** The most robust recognition. Rejected for the reason [Base orders compose with an existing AGENTS.md](../architecture/2026-09-17-base-orders-compose-with-an-existing-agents-md.md) already gives: it changes what every fresh repository gets, putting tool markers around a document that is not a contribution to someone else's file.

**Write the manifest first, as a pending adoption marker.** Would stop a failed run from leaving an unrecognised document. Rejected because it does not cover a deleted manifest, and a run that failed before composing would then leave a document the next run keeps without the orders.

**Compose only when the file matches the template exactly.** Rejected because any hand edit breaks equality, which reintroduces the duplicate this record fixes.

**Keep only top-level keys, and let the template win inside shared values.** Simpler. Rejected because the entries users edit — a gate's `advisory`, a document's share — live one level down, and a rule that stops at the top would still revert them.

**Replace a symlink out of the repository with a regular file.** Would let the run complete. Rejected because the link is the repository's, and the run cannot know whether the link or the file it names is the mistake.

**Treat a failed simulation as a warning and write anyway.** Rejected because a partial tree is the state that made the duplicate possible, and the refusals the simulation raises are exactly the ones the user has to resolve by hand.

## Consequences

A re-run is idempotent whether or not the manifest survives, a run that refuses writes nothing, and a dry run's report equals the real run's line for line. A repository's edits to merged manifests survive re-runs, and the report says which differences were kept.

The cost is that a template change to an entry the repository already holds no longer reaches it without `--force`, which also rewrites every other file. The report names each kept entry, so the user can apply the new value by hand instead.

Content recognition is a threshold. A copy of the orders rewritten until fewer than half of its long lines survive, in a repository whose manifest is gone, receives the base orders again as a marked section — visible, not silent. A repository document that happens to repeat half the template's long lines verbatim would be taken for the orders and kept.

A real run does the file phase twice, once in memory. The plans are small, so this costs milliseconds.

`--force` no longer resets the manifest's adoption date or drops layers from it.

## Related

The merge vocabulary this extends is in [The merge reports what it changed](2026-09-16-the-merge-reports-what-it-changed.md). The compose form is in [Base orders compose with an existing AGENTS.md](../architecture/2026-09-17-base-orders-compose-with-an-existing-agents-md.md). The hook rules are in [Adoption never displaces a hook](2026-09-17-adoption-never-displaces-a-hook.md).
