# Decision Record: Scaffolded repositories check each edit

Status: implemented

## Problem

The shipped gates judge a commit, so an agent in a scaffolded repository learned it had broken a file only when it next committed, often several edits later. This repository had already moved that feedback to the edit itself, in [edits are checked and formatted as they are made](../process/2026-09-23-edits-are-checked-and-formatted-as-they-are-made.md), but that hook was its own tooling and shipped to no one. Shipping it needed three things the local hook did not: a check per language that each layer could contribute without restating the others, a way to join a `.claude/settings.json` the repository may already have, and a rule for which formatter may rewrite a file in a repository this tool does not own.

## Decision

The base layer writes `.claude/hooks/post-edit.mjs`, a dispatcher, and `.claude/hooks/post-edit.json`, its manifest. Each entry under `checks` names the extensions it judges and the argument vector that judges them, with `{file}`, `{hooks}`, and `{node}` filled in, a list of candidate programs in first place, `optional` for a program the repository may not have, and `exclude` for paths it never judges. Required checks run before optional ones. A check that exits nonzero rejects the file and the hook exits 2, which Claude Code hands back to the agent; a program that is not installed, or a check that exits 127, is reported with exit 1 and does not block the edit. Each stack layer adds its own entry with a `.merge` template, so a layer contributes a check without restating the base ones.

The rule for what runs is the one that survives translation between languages: always check the syntax, and format only with a language's single canonical formatter or with one the repository installed itself.

- **base**: `node --check` for JavaScript, `JSON.parse` for JSON except files that may hold comments such as `tsconfig.json`, and the repository's own `node_modules/.bin/prettier` when there is one.
- **python**: `ast.parse` through the interpreter on `PATH`, which leaves no `__pycache__` behind. No formatter: Python has no single one its community agrees on.
- **go**: `gofmt -w`, which also rejects a file that does not parse.
- **rust**: `rustfmt` on the edited file at the edition of the crate that owns it, which `rustfmt-file.mjs` reads from `cargo metadata`. `cargo fmt` would format the whole crate, and a bare `rustfmt` parses at its own default edition.
- **typescript**: `typescript-syntax.mjs` parses the file with the compiler the repository depends on, as the TypeScript gates do. Type errors need the whole program and stay with `verify-typescript-types`.

The hook is registered by appending one entry to `hooks.PostToolUse` in `.claude/settings.json`, identified by its command, so a re-run adds nothing and the repository's own hooks and settings are kept. A settings file that is not valid JSON, or holds `hooks` in another shape, is left exactly as it is and the run says what to add by hand. `--no-hooks` skips this registration as it skips the pre-commit hook. `tests/edit-hook.test.mjs` breaks one file per check and asserts the rejection, and `npm run check` runs the composed hook in every layer combination against a broken and a sound JSON file.

## Alternatives considered

**Register the hook with a `.merge` template.** Uses the existing form. Rejected because a merge replaces a list both sides hold: a repository with its own `PostToolUse` hooks would either keep them and never gain this one, or, with `--force`, lose them.

**Ship Prettier, ruff, or ESLint and run them everywhere.** More thorough. Rejected because this tool has no dependencies to ship them with, and because formatting a repository with a tool it never chose rewrites every file an agent touches in a style nobody agreed to. A repository that installs Prettier gets it; one that adopts ruff or ESLint adds an entry to the manifest.

**One hook entry per stack in the settings file.** Simpler registration. Rejected because each entry would start its own process on every edit and read nothing the others learned, and because the per-language checks would then live in a file the repository owns rather than in a manifest the layers compose.

**Reuse this repository's own hook.** Already tested. Rejected because it fetches a pinned Prettier through `npx`, which fits a package that has no `node_modules` of its own and would be wrong in one that does.

## Consequences

An agent in a scaffolded repository sees a broken file on the edit that broke it, in any of the profiled languages, and a formatter runs only where the repository chose one. Each edit costs one Node start plus the matching checks; `rustfmt-file.mjs` adds a `cargo metadata` call. A file an agent writes through a shell command rather than an edit tool is not seen by the hook, so the commit gates remain the backstop. A repository that wants a linter as well adds an entry to `.claude/hooks/post-edit.json`, which the templates never overwrite once written.
