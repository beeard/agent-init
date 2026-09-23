# Design

Why `agent-init` is built the way it is. Decisions with alternatives that lost are recorded in [.agents/notes/](../.agents/notes/README.md); this document explains the shape of the whole thing.

## The problem

Two failure modes, and they need one solution.

**An agent with no written rules invents some.** They differ between sessions, are invisible in review, and cannot be improved because nobody can point at them. The repository accumulates conventions that exist only in the habits of whoever worked on it last.

**Written rules drift.** A document that states a rule nobody checks decays quietly. It says the code does one thing while the code does another, and the cost lands on the next reader who trusts it.

The tool addresses both by never shipping a rule without the check that enforces it. That is the whole design constraint, and most of the choices below follow from it.

## Rules and gates as one artifact

Every rule in the generated `AGENTS.md` either names the gate that enforces it or is honest that it is a judgment call.

The result is a small set of gates that are cheap to run, which matters more than coverage. A gate that takes thirty seconds will be skipped. The pre-commit hook runs the commit group; the whole-repository gate belongs before a push, not before every commit.

## Zero runtime dependencies

The tool writes files and runs checks, and the Node standard library does both. A dependency would have to be installed before the tool that scaffolds a repository could run, which inverts the bootstrap: the first thing you do to a fresh checkout would be to install something.

Concretely this ruled out a real Markdown parser. `verify-md-wrap` therefore uses a line-oriented block scanner rather than an abstract syntax tree, and the scanner documents what it does not model. That is a genuine loss of precision — a document using deeply indented nested lists may be misread — accepted in exchange for a tool that runs anywhere Node does.

The lesson applied throughout: when precision and reachable-with-nothing conflict, take the check that actually runs.

## Why the gates ship into the target

The gates are copied into the receiving repository rather than run from here. Three reasons:

- The repository can change them. A rule that does not fit gets edited, not abandoned.
- They keep working when this tool is gone, uninstalled, or never updated.
- CI runs them without knowing this tool exists.

The cost is that improvements do not propagate automatically. That is the right trade for a scaffolder: the alternative is a repository whose rules silently change when an unrelated package updates.

## Why the templates dogfood

`npm run check` runs the shipped gates against the shipped templates, with the templates' own budgets.

A template that would fail the gates in a receiving repository fails here first. Without this, every template edit is a guess about whether it will pass, and the first thing a user sees after running the tool is a failing check — the worst possible first impression for a tool whose pitch is "the rules and the checks agree".

The configuration points the gates at `templates/**`, and relative links inside templates resolve correctly because a template directory mirrors the layout of the repository it generates.

## Why layers

The `base` layer is about how agents work: standing orders, decision records, skills, documentation discipline. It knows nothing about the language the software is written in, and that neutrality is what lets it apply to a Python library, a Go service, and a documentation repository equally.

Everything else is a layer on top.

**Stack layers** (`--stack <name>`) add what is specific to a language: a testing guide, language-specific standing orders, and a gate enforcing a rule that language's community already agrees on. The test for whether something belongs here is whether it survives translating into another language.

**The architecture layer** (`--with-architecture`) adds how software is composed: plugins, seams, reversible registrations, the model-visible-equals-logged rule. It applies only to systems actually built that way.

Merging these into one layer would give every repository a map of an architecture it does not have, and rules about a language it does not use. A wrong rule is worse than no rule, because it directs work to the wrong place.

### A layer contributes by suffix, not by editing

A layer is a directory with the same shape as the composed result, and its filename suffix decides how each file is applied:

- **No suffix** writes the file. A later layer writing the same path replaces it.
- **`.append`** appends to the named file inside `<!-- agent-init:begin <layer> -->` markers.
- **`.merge`** merges a JSON object into the named file: a key holding an object on both sides merges one level deeper, so several layers contribute to one shared value instead of overwriting each other, while every other key is replaced. A value the file already held before the run is kept unless `--force`, so a re-run never reverts a repository's own edit. A key the two sides disagree about the shape of fails the run rather than being resolved either way, because composing a shared value and setting one outright are different intents and the shapes are what tell them apart.
- **`.compose`** writes the file when it is absent, appends it inside the layer's markers when the repository already had that file and had not adopted this structure, and keeps it once adopted or once the file already carries the content, so a lost manifest never duplicates the orders.

The marker naming the layer is not decoration. With one shared marker, a second layer appending to `AGENTS.md` finds the marker present and contributes nothing — silently, with no failing check.

`.compose` exists because the root `AGENTS.md` is the one document a receiving repository is likely to already have; the adoption manifest is what tells a file this tool wrote from one the repository had.

`.merge` prevents the same failure in the other direction: a layer listing a manifest's complete contents goes stale the moment a lower layer adds an entry, and surfaces months later in an unrelated repository.

## Why adoption is lenient first

A repository that already exists has already broken some of these rules — its documentation is hard-wrapped, its public functions are undocumented. Running the gates immediately produces a wall of findings about rules the team never agreed to, and the reasonable response is to delete the tool.

So every gate can be marked advisory: it reports the same findings and does not fail the run. `--lenient` marks them all advisory at scaffold time, and a team clears findings and tightens gates one at a time. Removing `"advisory": true` is the moment a rule is actually adopted.

## Why the archive is frozen

Decision records accumulate, and most stop being useful. Deleting them loses the rationale that prevents a settled question from being reopened.

The archive resolves this by keeping the record and removing its authority: it is preserved, and explicitly not a statement about current behavior. Freezing it completely — no edits, no reformatting, not even a link fix — is what makes that distinction hold. The moment an archived record can be updated, it becomes a second, staler source of truth.

## Why there is no index

A centralized index of decision records is a second thing to update on every change, and it goes stale invisibly. The directory tree is already an index: lifecycles and classes are folders, and search covers the rest.

This is the "one home per fact" rule applied to the record set itself.

## What the tool deliberately does not do

- **It does not know your language.** No test runner is configured, no linter, no build. A stack layer adds a rule or two, and a TypeScript project also gets a `tsconfig.json` and a declared compiler so `tsc` can run — but nothing runs your tests, and the type checker stays the project's.
- **It does not write a real architecture map.** It writes the skeleton, because only you know the system. A generated map would be confidently empty.
- **It does not run on a schedule or enforce anything at runtime.** It writes files once, and the repository owns them from then on.
- **It does not overwrite.** Re-running keeps existing files, so the tool can be re-run after an upgrade to add new files without destroying the edits a repository has made to the old ones.
