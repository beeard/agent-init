# agent-init

Scaffold an agent-operating structure into any repository.

`agent-init` writes a self-contained tree — standing orders, decision records, skills, and the gates that enforce them — into a repository you name. Nothing it writes refers back to this package: the receiving repository owns the result outright, and its rules keep working if this tool is never run again.

## Why

An agent working in a repository with no written rules will invent some. They will be inconsistent session to session, invisible to review, and impossible to improve.

Written rules have the opposite failure: a document nobody reads, drifting away from what the code does. `agent-init` addresses both by shipping rules **together with the checks that enforce them**. A rule that no check can verify is a suggestion; a check with no stated rule is a mystery. The pair is the product.

## Quick start

```sh
node /path/to/agent-init/src/cli.mjs . --name "My Project"
```

Or link it once and use it anywhere:

```sh
ln -s /path/to/agent-init/src/cli.mjs ~/.local/bin/agent-init
cd ~/Projects/new-thing && agent-init .
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
  manifest.json               records what was adopted, and when
  notes/
    README.md                 the decision-record standard
    AGENTS.md                 subtree orders + the supersession check
    proposed/                 unbuilt decisions
    implemented/              shipped decisions
    rejected/                 declined proposals
    archived/                 frozen history
  skills/
    <slug>-agent-notes/       when and how to write a decision record
    <slug>-pre-push-checks/   selecting the smallest covering evidence
    <slug>-prose-standard/    what prose must say, and what it must not
    <slug>-code-review/       reviewing against this repository's standards
docs/
  AGENTS.md                   the documentation standard: tiers, budgets, slop checklist
  architecture.md             the system map, as a skeleton to fill in
scripts/gates/                the checks, zero dependencies
.githooks/pre-commit          the fast subset, installed and activated
```

## Options

| Flag | Effect |
|---|---|
| `--name <name>` | Project name for the generated documents. Defaults to the directory name. |
| `--skills a,b,c` | Which skills to include, or `all`. |
| `--with-architecture` | Add the second layer (below). |
| `--no-hooks` | Do not install the pre-commit hook. |
| `--force` | Overwrite files that already exist. |
| `--dry-run` | Print the plan, write nothing. |
| `--allow-non-git` | Scaffold outside a Git worktree. |

Re-running is safe: existing files are kept unless you pass `--force`.

## The two layers

**`base`** is the general structure. It knows nothing about how your software is built, and applies to a Python library, a Go service, or a documentation repository equally.

**`architecture`** is opt-in and adds the composition discipline: a running system assembled from plugins, capability seams with their three roles, registrations as reversible effects, and the rule that anything model-visible is logged. Use it when the system really is composed that way; skip it otherwise, because a map of an architecture you do not have is worse than no map.

Applying it adds a composed system map, a glossary, and a composition guide under `docs/`, plus a section of architecture standing orders appended to `AGENTS.md`. The sources are in [templates/architecture/](templates/architecture/).

## The gates

Zero runtime dependencies, plain Node ESM, each runnable on its own.

| Gate | Rejects |
|---|---|
| `agent-note-tree.mjs` | Records outside `{lifecycle}/{class}/date-topic.md`; unknown lifecycles or classes; a centralized index |
| `verify-agent-note-format.mjs` | Bad header, missing sections, a decision recorded without its alternatives, proposal-era headings in a shipped record |
| `verify-md-wrap.mjs` | A prose paragraph spanning more than one physical line |
| `verify-md-links.mjs` | A relative link whose target does not exist |
| `verify-doc-budgets.mjs` | A standing document over its word ceiling, or a budgeted document that vanished |

```sh
node scripts/gates/run.mjs              # all of them
node scripts/gates/run.mjs --group fast # the pre-commit subset
node scripts/gates/verify-md-wrap.mjs --staged   # only what you are committing
node scripts/gates/change-scope.mjs --base origin/main
```

The installed pre-commit hook runs the fast subset plus the staged paragraph check, so a wrapped paragraph is caught as it is introduced without scanning the whole repository on every commit.

`change-scope` reports what a change actually touches — committed paths against a merge base, plus staged, unstaged, and untracked ones — so an agent can pick the evidence the change needs instead of running everything. It never guesses or fetches a base.

## Design

See [docs/design.md](docs/design.md) for why the tool is built the way it is, and [.agents/notes/](.agents/notes/README.md) for the decisions behind it.

## Requirements

Node 20 or newer. Nothing else — no package manager install, no build step, no dependencies.
