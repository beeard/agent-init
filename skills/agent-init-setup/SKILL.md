---
name: agent-init-setup
description: Set up the agent-operating structure in a project with agent-init — standing orders in AGENTS.md, decision records, skills, and the gates that enforce them. Use when the user wants to set up the project, make the repo agent-ready, add rules and checks, start a new project properly, or wants an agent to have written rules to follow in a repository, including when an existing repository should adopt the structure. Picks the language profiles from what the repository actually contains. Do not use on a repository that already has `.agents/manifest.json` — it is already set up, and a re-run is only worth it to add a layer. Triggers: agent-init, scaffold, set up project, agent-ready, standing orders, AGENTS.md, decision records, gates, new project.
---

# Set up a project with agent-init

The tool writes a self-contained tree into the repository: `AGENTS.md` with standing orders, `CLAUDE.md` as a symlink to it, `.agents/` with decision records and skills, `docs/` with the documentation standard, and `scripts/gates/` with the checks that enforce the rules. Everything it writes is owned by the receiving repository — nothing refers back to the tool.

## Find the tool

It is run from a clone or from a linked command. Check in that order:

```sh
command -v agent-init || ls ./*/src/cli.mjs 2>/dev/null
```

If neither answers, ask the user where the clone is rather than guessing — the tool is not published, so there is no canonical download location to fall back on. Do not improvise a substitute, and do not reach for `npx`: the package is not published.

A linked command needs the file to be executable. If `command -v agent-init` finds a path that fails with `Permission denied`, run `chmod +x` on the `src/cli.mjs` the link points at, and report it upstream rather than working around it.

## Check whether it is already set up

```sh
head -20 .agents/manifest.json 2>/dev/null
```

The manifest is written by every run and kept on a re-run, so it exists in every repository that has adopted the structure. Its `layers` field says what was already chosen.

Do not use the `agent-init:begin` markers in `AGENTS.md` as the check: they only exist once a stack or architecture layer has contributed a section, so a repository set up with `base` alone has none of them.

If the manifest is there, say so, and ask whether what remains is adding a layer (`--stack <name>`) rather than running again.

## Find the language profiles

Read the repository rather than assuming. Each hit gives one `--stack`:

| You see | Stack |
|---|---|
| `go.mod` | `go` |
| `pyproject.toml`, `setup.py`, `setup.cfg`, `requirements.txt`, or `*.py` in the root | `python` |
| `Cargo.toml` | `rust` |
| `tsconfig.json`, or `package.json` with `typescript` among the dependencies | `typescript` |

```sh
fd -d 1 'go\.mod|pyproject\.toml|setup\.(py|cfg)|requirements\.txt|Cargo\.toml|tsconfig\.json|package\.json'
```

There is no `javascript` stack. A plain JS project gets `base` alone, which is correct — base is language-neutral by design.

For several languages, take each stack the repository actually maintains rather than every file type you can see. An `examples/` tree in another language is not a language the repository owns. Each stack adds a gate that requires that language's toolchain, so a stack that cannot run is a gate that fails.

## Fresh or existing repository

```sh
git rev-list --count HEAD 2>/dev/null || echo 0
```

- **Empty repository, no commits** → run without `--lenient`. The gates are strict from the first day, and a fresh tree passes them.
- **Repository with history or content** → add `--lenient`. Every gate becomes advisory, so the first run reports the backlog instead of failing on rules the team never agreed to. Tell the user the gates are tightened one at a time by removing `"advisory": true` in `scripts/gates/gates.json`.

**If the directory is not a Git repository at all**, the tool refuses to run. Run `git init` first, which is almost always what the user wants. `--allow-non-git` exists for genuine exceptions only: without Git the repository loses `change-scope`, and the `--staged` bounds in the commit gates fall back to scanning everything.

## Run it

```sh
agent-init . --name "<Project Name>" --stack <a> [--stack <b>] [--lenient]
```

- The name defaults to the directory name. Use the real project name, with capitals and spaces — the tool makes the slug itself.
- `--dry-run` writes nothing. Use it when the user is unsure, and show them the plan.
- `--with-architecture` **only** when the system really is assembled from plugins or extension points. A map of an architecture the repository does not have is worse than no map. Ask when in doubt rather than guessing.

## TypeScript projects

`--stack typescript` initialises the toolchain as well as the rules:

- **No `tsconfig.json`** → the tool writes one, along with a `package.json` carrying `typecheck`, the gate scripts, and `typescript` in `devDependencies`. Run `npm install` so the compiler the gates resolve is actually there.
- **An existing `tsconfig.json`** → the tool keeps it untouched and prints a note for every option the TypeScript orders assume but the file does not set, and for every value that differs from the recommended one. A `package.json` whose `type` is not `module` is reported the same way, because ESM depends on it.

When it reports findings on an existing config, **ask before editing**. Say which options are missing or differ and why they matter, then apply them only on a yes. Edit the file in place so its comments survive — never round-trip it through a JSON writer, and never narrow `strict` or `include` to make a finding go away.

## Afterwards

**1. Run the gates in the new tree and report the actual result:**

```sh
node scripts/gates/run.mjs
```

Green means the structure is internally consistent. With `--lenient` the findings are advisory and the run passes — read them to the user anyway, since they are that repository's real backlog.

**2. Read what the hook reported.** One of:

- `activated` — the pre-commit hook runs the gates on every commit. Nothing to do.
- `not activated` — `core.hooksPath` already points at another hooks directory, so the tool left it alone instead of taking it over. Check whether that directory has a `pre-commit` that chains to the repository's own hook: if it does, the gates run anyway and there is nothing to fix. If not, the gates run only when invoked by hand.

Do not point `core.hooksPath` at `.githooks` to "fix" this without asking. Git has one hooksPath, so that silently disables whatever the other directory was providing — a global `pre-push` review hook, for instance. Say what would be lost and let the user choose.

**3. Do not commit.** Say the tree is ready and let the user decide whether it goes in as one commit. The structure's own rules forbid committing and pushing unless asked.

## What not to do

- **Do not rewrite `AGENTS.md`.** It is deliberately generic. The user makes it theirs; the tool has already added what is right for the languages and the architecture.
- **Do not run `--force`.** It overwrites files the user has edited. If an update is needed, ask first.
- **Do not re-run to update.** A re-run keeps existing files, so it changes nothing without `--force` — it is safe, not useful.
