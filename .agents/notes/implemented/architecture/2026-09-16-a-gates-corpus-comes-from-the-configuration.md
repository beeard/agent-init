# Decision Record: A gate's corpus comes from the configuration

Status: implemented

## Problem

`verify-final-newline` checked a corpus of its own invention. It read `finalNewlineGlobs` and `finalNewlineSkipDirectories` from `scripts/gates/config.json`, and no configuration the tool has ever shipped declares either key. The contract existed only on the reading side: everywhere the built-in defaults applied, and a maintainer who wanted to widen or narrow the check had to read the gate to learn which two names it would have answered to.

What those defaults selected was narrower than the rule they enforce. The standing orders state that every file ends with exactly one newline, and the globs were `**/*.md` and its siblings, which the repository walker expands without descending into dot-directories. `.agents/notes/**` was therefore read by no configuration of this gate, while `markdownGlobs` and `linkGlobs` both name it explicitly. The gate that enforces the rule covered less than the documentation gates that cite it.

Exclusion was narrower in the direction that costs more. A path was skipped when any of its segments was one of seven built-in directory names, so `venv/` and `target/` were read even though the layer that owns them had declared them as output it does not own. The Python layer lists `venv` and `site-packages` in `pythonSkipDirectories` precisely so no gate reads them, and this gate failed the project over a vendored file that no language gate would open. The frozen archive was skipped only because it happens to sit under a dot-directory, which is a second reason the defect was invisible: the accident covered for the missing rule.

## Decision

A gate takes its corpus and its exclusions from the configuration that every gate shares, and adds a reading of its own only where its rule needs one.

`verify-final-newline` builds its corpus from the built-in text globs plus every glob the configuration declares under a `*Globs` key other than `skipGlobs`. It excludes the shared `skipGlobs`, expanded through `skipPredicate` so the frozen archive is named once for every gate at once, together with every directory named under any `*SkipDirectories` key.

The two halves are deliberately asymmetric.

On the corpus side the configuration can widen the check and cannot narrow it. The built-in globs are a floor rather than a default, so emptying a list, or declaring one carelessly, leaves the rule covering the same files it covered before. The alternative is a gate that reports a clean run over nothing, which is the failure the standing orders call out directly: a check never reports a result it did not produce.

On the exclusion side the configuration is authoritative. A layer knows its own build and dependency output and the gate does not, so the built-in names are the floor for a repository that has declared nothing and the declared names are added to them.

A directory name excludes a file only where it is a directory in that file's path. A file that happens to be called `build` is not a build directory.

## Alternatives considered

**Declare `finalNewlineGlobs` in the shipped `config.json`, so the key the gate reads exists.** The smallest change that answers the half of the problem about a missing contract, and it would have made the vocabulary legitimate. Rejected because it leaves the gate holding a list of its own in step with `markdownGlobs`, `linkGlobs`, and every layer's language globs, and that drift is silent in the direction that matters: a corpus that narrowed would report the same clean run as one that passed.

**Widen the repository walker so `**` descends into dot-directories.** Would give `**/*.md` the reach that `markdownGlobs` achieves by naming `.agents/` explicitly, and would fix it for every gate at once instead of for this one. Rejected because a leading wildcard not matching a dot name is the convention the surrounding ecosystem follows and the walker's own documentation states, so changing it would silently widen the corpus of every gate that writes `**` and expects the usual meaning. A repository that wants those files names them, which is what `markdownGlobs` does.

**Match a skip directory only at the top of the tree.** Would stop `docs/build/notes.md` from being dropped, which is the one case where matching at any depth is clearly wrong. Rejected because it breaks the case that actually occurs, `node_modules` nested inside a workspace package, in order to fix one that does not, and because all four language gates already match at any depth. Changing it here alone would make the gates disagree about what a directory name means.

**Derive the corpus from the language layers' globs alone.** Would tie the rule to the languages the repository uses, so a repository that adds TypeScript gets its `.ts` files checked without anyone editing the newline configuration. Rejected because the rule is not about the languages in use. A base-only repository would then check nothing but Markdown, and the standing order would be enforced over a smaller set than the sentence it states.

## Consequences

The rule covers the files it claims to, and a language's build output is excluded by the layer that knows what it is rather than by a list the gate keeps for itself. The package's own run went from 45 files to 53: the nine `.agents/notes/**` documents that the explicit `markdownGlobs` entries reach and a bare `**/*.md` never did, less the archived one that `skipGlobs` now excludes. The templates were already in range, since `templates/` is not a dot-directory. That difference is the measure of how much the old corpus had missed.

The cost is that the gate reads a configuration vocabulary it does not own. A new `*Globs` key added for an unrelated purpose silently widens this corpus. The change is in the safe direction, since more files checked is more of the rule enforced, but it is a coupling the gate cannot announce, and a stack that declared a newline list of its own would find it read rather than honoured.

A second cost is that the asymmetry is a rule to remember rather than a property to observe. Nothing checks that a glob list was meant to widen this gate, and nothing checks that a skip directory a layer declares is one the repository actually has.

A third cost is that a directory named `build`, `dist`, `target`, or `vendor` anywhere in the tree takes its contents out of the rule, including a documentation directory under `docs/`. That is the convention the ecosystem uses for those names and the behaviour every other gate here already had, so the corpus is consistent at the price of being wrong in that one case.

## Related

The rule this gate enforces, and the other gates it ships with, are in [Ship the gates with the rules](2026-09-15-gates-ship-with-the-rules.md). The layer contract that decides which configuration a stack contributes is in [Layer stack profiles as additive overlays](2026-09-15-layer-stack-profiles-as-overlays.md).
