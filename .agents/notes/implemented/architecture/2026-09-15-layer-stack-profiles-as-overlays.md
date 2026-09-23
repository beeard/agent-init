# Decision Record: Layer stack profiles as additive overlays

Status: implemented

## Problem

The base structure is language-neutral by design: it checks Markdown, record layout, and link integrity, none of which depend on what the code is written in. That neutrality is what lets it apply to a Python library, a Go service, and a documentation repository equally.

It also means the tool says nothing useful about the language. A Python repository adopting it gets no opinion on test layout, no rule about docstrings, and no way to enforce either — the two things a Python contributor actually argues about.

Adding language profiles raised a second problem. A profile has to contribute to files the base layer already writes: a new gate must appear in the gate inventory, a new document must appear in the word budgets, and new standing orders must appear in `AGENTS.md`. The first implementation appended sections between a fixed `<!-- agent-init:begin -->` marker pair. Two layers appending to the same file silently dropped the second layer's section: the marker was already present, so the append reported success and wrote nothing.

## Decision

A language profile is an additive overlay applied after `base`, selected with `--stack <name>`, and contributing to the composed result through three template forms chosen by filename suffix.

- **No suffix** writes the file. A later layer writing the same path replaces it, so only the last write survives.
- **`.append`** appends to the named file inside `<!-- agent-init:begin <layer> -->` markers. The marker names the contributing layer, so a second layer finds its own marker absent and appends its own section. A re-run finds the marker present and does nothing.
- **`.merge`** merges a JSON object into the named file: a key holding an object on both sides merges one level deeper, every other key is replaced, and a key whose shape the two sides disagree about fails the run. A layer adds its entries without restating the ones below it.

Manifests use `.merge`: `gates.json`, `config.json`, and `doc-budgets.manifest.json`. Standing orders use `.append`. Everything else writes.

The gate inventory moved from a constant in `run.mjs` into `gates.json`, keyed by script name, so a layer registers a gate by merging one entry rather than by editing Node source. Each entry names the groups it belongs to and whether it is advisory. The groups are `commit` (what the pre-commit hook runs, with `--staged`) and `full` (the whole repository).

A gate in the `commit` group judges the same files it judges in `full`, restricted to the staged subset — never a different set. A staged run that reached wider than the repository run would fail a commit over files the rule was never written for, and a rule a file cannot satisfy has no remedy but `--no-verify`, which costs the gate every future run.

A gate marked `advisory` prints its findings and does not fail the run. `--lenient` marks every gate advisory at scaffold time, so adopting on an existing repository does not open with the complete backlog of rules that repository has not followed yet.

The Python profile ships one gate, `verify-python-docstrings.mjs`, which requires a docstring on every public module, class, function, and method. It analyzes through Python's own `ast` module in a subprocess rather than a reimplemented parser. It ships advisory, because enforcing it on an existing codebase would fail on day one.

`npm run check` verifies every layer combination — base, python, architecture, and python with architecture — by applying each through the real scaffolder into a throwaway directory and running the shipped gates on the result. A layer is never checked in place, because it is a partial overlay whose relative links and manifests are written for the composed tree.

## Alternatives considered

**Check each layer directory in place, with the gates pointed at `templates/`.** Simpler, and it avoids materializing throwaway trees on every check. Rejected because it checks something no receiving repository ever receives. A layer is a partial overlay: `templates/architecture/docs/architecture.md` links to `../.agents/notes/README.md`, which exists only in the composed tree, and its budget manifest lists only the entries that layer contributes. Checking in place reports failures that are artifacts of the overlay, and the fix people reach for is to weaken the check until it stops complaining.

**Have each layer restate the complete manifests it needs, replacing rather than merging.** This is what the architecture layer did first: it shipped a full `doc-budgets.manifest.json` naming every budgeted document. Rejected because it breaks the moment a lower layer changes — a profile that lists the base's budgeted documents goes stale silently when the base adds one, and the failure appears as a missing-file error in some unrelated repository, months later. It also made the layer combinations exclusive: a full manifest from the Python profile plus one from the architecture layer cannot both be right.

**Reuse one append marker for every layer and detect duplicates by heading.** Would avoid touching the marker format. Rejected because it makes the append idempotence check depend on prose matching. A layer that legitimately repeats a heading, or edits its own heading text, would either append a duplicate or skip a real contribution — a silent failure in both directions.

**Parse Python in JavaScript.** The tool has no runtime dependencies, so a Python parser would have to be hand-rolled. Rejected because a partial parser does not fail loudly; it misreads decorators, multi-line signatures, and nested definitions and reports findings that are wrong rather than merely incomplete. Shelling out to `python3 -c` with `ast` uses a correct parser that is already installed in the environment the gate is checking, and the dependency is explicit and checkable: the gate says so plainly when no interpreter is found.

**Enforce the docstring rule from the start.** Rejected because the first run in any existing repository would fail on hundreds of findings, and the tool's first impression would be a wall of red about a rule the team never agreed to. Advisory reports the same findings while letting a team clear them at its own pace, and removing `"advisory": true` is the moment they adopt the rule.

**Skip `--staged` and scan the whole repository on every commit.** Simpler, and correct on small repositories. Rejected because the cost grows with the repository and the hook runs on every commit; a hook that takes seconds gets bypassed with `--no-verify`, and a bypassed gate enforces nothing. Scanning only staged files keeps the hook constant-time in the size of the change.

## Consequences

A language profile is now a directory with the same shape as `base`, contributing through suffixes rather than through edits to the base. Adding a second language is adding a directory and a name to `STACKS`; the CLI, the merge machinery, and the dogfood check already handle it.

The layer order is fixed as base, then stacks in the order given, then architecture, so a layer's standing orders appear in a predictable sequence in the generated `AGENTS.md`.

The cost is that three template forms now exist and the suffix carries the whole contract: a file renamed without its suffix changes how it is applied, and nothing checks that. A `.merge` template whose content is not a JSON object throws during application rather than being ignored, which catches the common case, but a `.merge` file that should have been `.append` fails only by producing wrong output.

A second cost is that `--staged` requires Git and falls back to the whole repository with a printed notice when Git cannot answer, so the constant-time property holds only inside a worktree. The commit group now also checks out the whole index before the gates run, which [the commit group judges the index](../bug-fix/2026-09-23-the-commit-group-judges-the-index.md) records; the gates' analysis stays proportional to the change, the checkout does not.

The dogfood check now runs four scaffolds instead of one, which is the bulk of `npm run check`'s runtime. That is accepted: the alternative is a layer that passes in isolation and fails on delivery, which is the failure the check exists to catch.
