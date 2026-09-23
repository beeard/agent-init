# agent-init

Scaffold an agent-operating structure into any repository.

It writes a self-contained tree — standing orders, decision records, skills, and the gates that enforce them. Nothing it writes refers back to this package: the receiving repository owns the result, and its rules keep working if this tool is never run again.

## Why

An agent working in a repository with no written rules invents them instead. They will be inconsistent session to session, invisible to review, and impossible to improve.

Written rules fail the other way: a document nobody reads, drifting away from what the code does. `agent-init` addresses both by shipping rules **together with the checks that enforce them**. A rule no check can verify is a suggestion; a check with no stated rule is a mystery. The pair is the product.

## Quick start

From a fresh repository:

```sh
npx @beeard/agent-init . --name "My Project" --stack python
```

`npx` needs neither an install nor a clone. `--stack` is optional and repeatable, and needs that language's toolchain. Then the shipped gates, in the repository it wrote: `node scripts/gates/run.mjs`.

## Let an agent do it

The package ships the procedure as a skill: it reads the repository, picks the language profiles, and runs the tool. One command installs it into `~/.claude/skills/`, so no later session needs this page:

```sh
npx @beeard/agent-init --install-skill
```

From a clone, `ln -s <clone>/skills/agent-init-setup ~/.claude/skills/agent-init-setup` links it instead, so edits to the clone take effect.

## What it writes

```text
AGENTS.md                     standing orders, budgeted
CLAUDE.md                     → AGENTS.md
.agents/
  manifest.json               what was adopted, and when
  notes/                      the decision-record tree and its standard
  skills/                     four workflows, each a skill named by its directory
.claude/skills/               → those, linked for the agent to read
docs/
  AGENTS.md                   the documentation standard: tiers, budgets, slop checklist
  architecture.md             the system map, as a skeleton to fill in
  defensive-patterns.md       bug classes that shipped, as the rule that prevents recurrence
scripts/gates/                the checks, zero dependencies
.githooks/pre-commit          what runs on every commit, installed and activated
```

The hook does not displace anything: an existing `.githooks/pre-commit` is kept unless `--force` is given, and `core.hooksPath` is left alone when it points elsewhere in any scope or `.git/hooks` holds an executable hook — Git reads one or the other, never both. It reports `not activated` and how to enable it: `git config core.hooksPath .githooks`, which replaces the other directory's hooks.

## Options

| Flag | Effect |
|---|---|
| `--name <name>` | Project name for the generated documents. Defaults to the directory name. |
| `--stack <name>` | Add a language profile. Repeatable. Available: `go`, `python`, `rust`, `typescript`. |
| `--skills a,b,c` | Which skills to include, or `all`. |
| `--with-architecture` | Add the composition discipline (below). |
| `--lenient` | Mark every gate advisory, for adopting an existing repository. |
| `--no-hooks` | Do not install the pre-commit hook |
| `--force` | Overwrite existing files. |
| `--dry-run` | Print the plan, write nothing. |
| `--allow-non-git` | Scaffold outside a Git worktree. |
| `--install-skill` | Install the setup skill instead of scaffolding; `--link`, `--skill-dir`. |

Re-running keeps files and edited JSON values unless `--force`.

## The layers

Layers apply in order, and each adds to the ones below it.

**`base`** is the general structure. It knows nothing about how your software is built, and applies to a Python library, a Go service, or a documentation repository equally.

**`--stack <name>`** adds what is specific to one language. Each profile ships a testing guide, standing orders, and a gate enforcing a rule that language's community agrees on.

The gate in every profile **delegates to the language's own tooling** rather than reimplementing a parser. A hand-rolled scan misreads decorators, grouped declarations, and type parameters, and reports findings that are wrong rather than merely incomplete.

| Stack | Gate | Analyzes through |
|---|---|---|
| `python` | `verify-python-docstrings.mjs` | Python's `ast` module, in a subprocess |
| `go` | `verify-go-docstrings.mjs` | `go/parser` and `go/ast`, via `go run` |
| `rust` | `verify-rust-doc-comments.mjs` | rustc's built-in `missing_docs` lint, via `cargo rustc` |
| `typescript` | `verify-typescript-doc-comments.mjs` | the `typescript` package from your own `node_modules` |
| `typescript` | `verify-typescript-types.mjs` | the project's own `tsc --noEmit`, against its `tsconfig.json` |

Every stack gate ships **advisory**: it reports findings without failing the run. Adopting on an existing codebase would otherwise greet the first run with the complete backlog of undocumented definitions. Clear the findings, then remove `"advisory": true` from that gate's entry in the generated `scripts/gates/gates.json`.

Two of them need something before they can run, and say so when it is missing:

- **Rust** needs nothing in the crate: the gate passes `-W missing_docs` to the compiler for every target of every workspace member, so a commented-out attribute cannot switch it off. A crate that does not compile fails the gate.
- **TypeScript** needs `typescript` resolvable from your repository, which any TypeScript project already has. It is your dependency, not this package's.

**`--stack typescript` also initialises the project.** A repository with no `tsconfig.json` gets the strict ESM config the standing orders describe, and a `package.json` (if it had none) declaring `typescript`, `typecheck`, and the gate scripts — run `npm install` afterwards. An existing `tsconfig.json` is left alone unless `--force`: the run reports every option the orders assume but the file does not set or sets differently. `verify-typescript-types` needs both a config and the compiler, and names whichever is missing.

**`--with-architecture`** adds the composition discipline: a system assembled from plugins, capability seams with their three roles, registrations as reversible effects, and the rule that anything model-visible is logged. Use it when the system really is composed that way; skip it otherwise, because a map of an architecture you do not have is worse than no map.

The sources are in [templates/](templates/).

## The gates

Zero dependencies, plain Node ESM, each runnable on its own. [gates.json](templates/base/scripts/gates/gates.json) is the inventory: each gate, the groups it belongs to, and whether it is advisory. A stack layer merges its own entries in.

| Gate | Group | Rejects |
|---|---|---|
| `agent-note-tree.mjs` | commit, full | Records outside `{lifecycle}/{class}/date-topic.md`; unknown lifecycles or classes; a centralized index |
| `verify-agent-note-format.mjs` | commit, full | Bad header, missing sections, a decision recorded without its alternatives, proposal-era headings in a shipped record |
| `verify-md-links.mjs` | commit, full | A relative link whose target does not exist |
| `verify-md-wrap.mjs` | commit, full | A prose paragraph spanning more than one physical line |
| `verify-final-newline.mjs` | commit, full | A file not ending in exactly one newline |
| `verify-issue-tags.mjs` | commit, full | A known-issue marker that names nothing |
| `verify-doc-budgets.mjs` | full | A standing document over its word ceiling, or a budgeted document that vanished |
| `verify-python-docstrings.mjs` | commit, full | A public Python definition without a docstring — advisory |
| `verify-go-docstrings.mjs` | commit, full | An exported Go declaration without a doc comment — advisory |
| `verify-typescript-doc-comments.mjs` | commit, full | An exported TypeScript declaration without JSDoc — advisory |
| `verify-typescript-types.mjs` | full | A project its own `tsc --noEmit` rejects — advisory |
| `verify-rust-doc-comments.mjs` | full | A public Rust item without a doc comment — advisory |

```sh
node scripts/gates/run.mjs                 # the whole-repository suite
node scripts/gates/run.mjs --group commit  # what the pre-commit hook runs
node scripts/gates/run.mjs --list          # what would run, and when
node scripts/gates/change-scope.mjs --base origin/main
```

Gates run concurrently (`--jobs 1` runs them in turn) and report in manifest order, so a new gate must not write where another reads.

Gates in the `commit` group run against a checkout of the index and receive `--staged`, so they judge exactly the staged content of the staged files. So the hook catches a violation in the commit that introduces it.

`change-scope` reports what a change actually touches — committed paths against a merge base, plus staged, unstaged, and untracked ones — so an agent can pick the evidence the change needs instead of running everything. It never guesses or fetches a base.

## Requirements

Node 20.11 or newer for the gates. A stack's gate needs that language's toolchain, and only when the stack is applied:

- `python` — an interpreter on `PATH` (`python3` or `python`)
- `go` — the Go toolchain
- `rust` — `cargo`
- `typescript` — the `typescript` package installed in your repository; `--stack typescript` declares it, and `npm install` fetches it

A missing toolchain fails the gate loud, naming what is missing and how to opt out. It never reports a clean run it did not perform.

Rust's and TypeScript's type gates run in the `full` group only. `missing_docs` is a per-crate lint and a type error is a property of the whole program, so both compile the project rather than scanning files, and the `commit` group's contract is a hook that stays fast. Move either to `commit` in `scripts/gates/gates.json` if your project is small enough to check on every commit.

## Design

See [docs/design.md](docs/design.md) for why the tool is built the way it is, and [.agents/notes/](.agents/notes/README.md) for the decisions behind it.

[docs/deliberate-omissions.md](docs/deliberate-omissions.md) records the concepts from the reference implementation that this tool does **not** ship, what each one solves, and the trigger that would make it worth adopting. It is there so an omission is a decision rather than an oversight.
