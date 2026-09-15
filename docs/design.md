# Design

Why `agent-init` is built the way it is. Decisions with alternatives that lost are recorded in [.agents/notes/](../.agents/notes/README.md); this document explains the shape of the whole thing.

## The problem

Two failure modes, and they need one solution.

**An agent with no written rules invents some.** They differ between sessions, are invisible in review, and cannot be improved because nobody can point at them. The repository accumulates conventions that exist only in the habits of whoever worked on it last.

**Written rules drift.** A document that states a rule nobody checks decays quietly. It says the code does one thing while the code does another, and the cost lands on the next reader who trusts it.

The tool addresses both by never shipping a rule without the check that enforces it. That is the whole design constraint, and most of the choices below follow from it.

## Rules and gates as one artifact

Every rule in the generated `AGENTS.md` either names the gate that enforces it or is honest that it is a judgment call.

The result is a small set of gates that are cheap to run, which matters more than coverage. A gate that takes thirty seconds will be skipped. The pre-commit hook runs three of the five; the other two are whole-repository scans that belong before a push, not before every commit.

## Zero runtime dependencies

The tool writes files and runs checks, and the Node standard library does both. A dependency would have to be installed before the tool that scaffolds a repository could run, which inverts the bootstrap: the first thing you do to a fresh checkout would be to install something.

Concretely this ruled out a real Markdown parser. `verify-md-wrap` therefore uses a line-oriented block scanner rather than an abstract syntax tree, and the scanner documents what it does not model. That is a genuine loss of precision — a document using link reference definitions or deeply indented nested lists may be misread — accepted in exchange for a tool that runs anywhere Node does.

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

## Why two layers

The `base` layer is about how agents work: standing orders, decision records, skills, documentation discipline. It applies to any repository in any language.

The `architecture` layer is about how software is composed: plugins, seams, reversible registrations, the model-visible-equals-logged rule. It applies only to systems actually built that way.

Merging them would mean every repository gets a map of an architecture it does not have, and the map would be confidently wrong. A wrong map is worse than none, because it directs changes to the wrong place. So the composition discipline is opt-in and explicitly labeled.

## Why the archive is frozen

Decision records accumulate, and most stop being useful. Deleting them loses the rationale that prevents a settled question from being reopened.

The archive resolves this by keeping the record and removing its authority: it is preserved, and explicitly not a statement about current behavior. Freezing it completely — no edits, no reformatting, not even a link fix — is what makes that distinction hold. The moment an archived record can be updated, it becomes a second, staler source of truth.

## Why there is no index

A centralized index of decision records is a second thing to update on every change, and it goes stale invisibly. The directory tree is already an index: lifecycles and classes are folders, and search covers the rest.

This is the "one home per fact" rule applied to the record set itself.

## What the tool deliberately does not do

- **It does not know your language.** No test runner is configured, no linter, no build. The gates check documents and record structure, which are the parts that are the same everywhere.
- **It does not write a real architecture map.** It writes the skeleton, because only you know the system. A generated map would be confidently empty.
- **It does not run on a schedule or enforce anything at runtime.** It writes files once, and the repository owns them from then on.
- **It does not overwrite.** Re-running keeps existing files, so the tool can be re-run after an upgrade to add new files without destroying the edits a repository has made to the old ones.
