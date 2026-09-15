# agent-init

Scaffold an agent-operating structure into any repository.

`agent-init` writes a self-contained tree — standing orders, decision records, skills, and the gates that enforce them — into a repository you name. Nothing it writes refers back to this package: the receiving repository owns the result outright, and its rules keep working if this tool is never run again.

## Why

An agent working in a repository with no written rules will invent some. They will be inconsistent session to session, invisible to review, and impossible to improve.

Written rules have the opposite failure: a document nobody reads, drifting away from what the code does. `agent-init` addresses both by shipping rules **together with the checks that enforce them**. A rule no check can verify is a suggestion; a check with no stated rule is a mystery. The pair is the product.

## Quick start

```sh
node /path/to/agent-init/src/cli.mjs . --name "My Project"
```

Or link it once and use it anywhere:

```sh
ln -s /path/to/agent-init/src/cli.mjs ~/.local/bin/agent-init
cd ~/Projects/new-thing && agent-init . --stack python
```

Then:

```sh
node scripts/gates/run.mjs   # the shipped gates, against your new tree
```

## What it writes

```text
AGENTS.md                     standing orders, budgeted
CLAUDE.md                     → AGENTS.md
.agents/
  manifest.json               what was adopted, and when
  notes/                      the decision-record tree and its standard
  skills/                     four workflows, prefixed with the project slug
docs/
  AGENTS.md                   the documentation standard: tiers, budgets, slop checklist
  architecture.md             the system map, as a skeleton to fill in
scripts/gates/                the checks, zero dependencies
.githooks/pre-commit          what runs on every commit, installed and activated
```

## Options

| Flag | Effect |
|---|---|
| `--name <name>` | Project name for the generated documents. Defaults to the directory name. |
| `--stack <name>` | Add a language profile. Repeatable. Available: `python`. |
| `--skills a,b,c` | Which skills to include, or `all`. |
| `--with-architecture` | Add the composition discipline (below). |
| `--lenient` | Mark every gate advisory, for adopting on an existing repository. |
| `--no-hooks` | Do not install the pre-commit hook. |
| `--force` | Overwrite files that already exist. |
| `--dry-run` | Print the plan, write nothing. |
| `--allow-non-git` | Scaffold outside a Git worktree. |

Re-running is safe: existing files are kept unless you pass `--force`.

## The layers

Layers apply in order, and each adds to the ones below it.

**`base`** is the general structure. It knows nothing about how your software is built, and applies to a Python library, a Go service, or a documentation repository equally.

**`--stack python`** adds what is specific to Python:

- **`docs/testing.md`** — pytest layout, how to select the smallest covering test, and the fixtures that keep a test from depending on time, randomness, or the working directory.
- **`AGENTS.md` orders** — public means no leading underscore, docstrings on everything public, `pytest.raises(..., match=...)`, dependencies in `pyproject.toml`.
- **`verify-python-docstrings.mjs`** — requires a docstring on every public module, class, function, and method.

The docstring gate ships **advisory**: it reports findings without failing the run. Adopting on an existing codebase would otherwise greet the first run with the complete backlog of undocumented definitions. Clear the findings, then remove `"advisory": true` from that gate's entry in the generated `scripts/gates/gates.json`.

**`--with-architecture`** adds the composition discipline: a system assembled from plugins, capability seams with their three roles, registrations as reversible effects, and the rule that anything model-visible is logged. Use it when the system really is composed that way; skip it otherwise, because a map of an architecture you do not have is worse than no map.

The sources are in [templates/](templates/).

## The gates

Zero runtime dependencies, plain Node ESM, each runnable on its own. [templates/base/scripts/gates/gates.json](templates/base/scripts/gates/gates.json) is the inventory: it names each gate, the groups it belongs to, and whether it is advisory. A stack layer adds its own gates by merging into that file.

| Gate | Group | Rejects |
|---|---|---|
| `agent-note-tree.mjs` | commit, full | Records outside `{lifecycle}/{class}/date-topic.md`; unknown lifecycles or classes; a centralized index |
| `verify-agent-note-format.mjs` | commit, full | Bad header, missing sections, a decision recorded without its alternatives, proposal-era headings in a shipped record |
| `verify-md-links.mjs` | commit, full | A relative link whose target does not exist |
| `verify-md-wrap.mjs` | commit, full | A prose paragraph spanning more than one physical line |
| `verify-doc-budgets.mjs` | full | A standing document over its word ceiling, or a budgeted document that vanished |
| `verify-python-docstrings.mjs` | commit, full | A public Python definition without a docstring — advisory by default |

```sh
node scripts/gates/run.mjs                 # the whole-repository suite
node scripts/gates/run.mjs --group commit  # what the pre-commit hook runs
node scripts/gates/run.mjs --list          # what would run, and when
node scripts/gates/change-scope.mjs --base origin/main
```

Gates in the `commit` group receive `--staged`, which restricts them to the files staged for commit — that is how the hook catches a wrapped paragraph or an undocumented function at the moment it is introduced without scanning the repository on every commit. A gate that does not support the flag ignores it.

`change-scope` reports what a change actually touches — committed paths against a merge base, plus staged, unstaged, and untracked ones — so an agent can pick the evidence the change needs instead of running everything. It never guesses or fetches a base.

## Requirements

Node 20 or newer for the gates. The `python` stack additionally needs an interpreter on `PATH` (`python3` or `python`) — the docstring gate analyzes through Python's own `ast` module rather than a reimplemented parser, and says so plainly if no interpreter is found.

## Design

See [docs/design.md](docs/design.md) for why the tool is built the way it is, and [.agents/notes/](.agents/notes/README.md) for the decisions behind it.
