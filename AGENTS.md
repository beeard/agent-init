# AGENTS.md

Standing orders for agents working on `agent-init`. This repository uses the structure it ships, so the rules below are the same ones it writes into other repositories. `CLAUDE.md` is a symlink to this file — edit `AGENTS.md`, never the link.

## Read before you change

- **Read a file before editing it.**
- **[README.md](README.md) explains the tool**; [docs/design.md](docs/design.md) explains why it is built this way.
- **Everything under `templates/` is product**, not project scaffolding. A template change changes what every receiving repository gets.
- **`templates/base/` must stand alone.** The stack and architecture layers add to it and may never contradict it, and none of them may assume a lower layer's entries will stay unchanged — that is what `.merge` templates are for.

## The template forms

A template file is applied according to its suffix, and the suffix is the whole contract:

| Suffix | Applied as |
|---|---|
| *(none)* | Written. A later layer writing the same path replaces it, so only the last write survives. |
| `.append` | Appended to the named file inside `<!-- agent-init:begin <layer> -->` markers, so a re-run stays idempotent and two layers can both contribute. |
| `.merge` | Merged into the named JSON object: a key holding an object on both sides merges one level deeper, every other key is replaced, and a key whose shape the two sides disagree on fails the run. Re-runs keep existing values unless `--force`. |
| `.compose` | Written as-is when the file is absent; appended inside the layer's markers when the repository already had that file and had not adopted this structure yet; kept once adopted or already present. Used where a `write` would either lose the repository's own file or re-inject the orders after every edit. |

A layer that restates a lower layer's entries instead of merging goes stale silently the moment the lower layer changes. Manifests — `gates.json`, `config.json`, `doc-budgets.manifest.json` — are `.merge` for exactly that reason.

## Working method

- **Zero runtime dependencies.** The package uses only the Node standard library. A dependency here would have to be installed before the tool that scaffolds a repository could run.
- **The gates are the specification.** A rule stated in prose in a template must be enforced by a gate in the same template, or it is a suggestion. When the two disagree, the gate is wrong.
- **A stack gate delegates to that language's own tooling.** Never scan declarations with a regular expression: the findings would be wrong rather than merely incomplete, and a gate whose output is not trusted is not run. Python uses `ast`, Go uses `go/parser`, Rust uses the built-in `missing_docs` lint, TypeScript uses the `typescript` package. A gate that cannot reach its toolchain fails loud; it never reports a clean run it did not perform.
- **Every gate needs a negative control.** A check that only ever runs green is untested. `tests/gates.test.mjs` breaks one thing per gate and asserts the rejection.
- **A stack layer may only add what is specific to that language.** A rule that holds for Python and Go alike belongs in `base`. The test is whether the rule survives translating it into another language.
- **Comment the contract, not the reasoning.**

## The dogfood rule

This repository runs its own gates against the product it ships:

```sh
npm run check
```

That check applies every layer combination — base alone, each stack alone, architecture alone, and every stack with architecture — through the real scaffolder into throwaway directories, and runs the shipped gates on the result. If a template would fail the gates in a fresh repository, it fails here first. **A change that makes `npm run check` fail is a defect in the product**, not in the check.

The combinations matter: a layer checked alone passes trivially, because a layer is a partial overlay whose links are written for the composed tree. A receiving repository gets only the composed result.

The matrix is derived from `STACKS`, so registering a stack there is enough to put it under the check. `buildPlan` fails loud when a declared layer contributes no files, and a test asserts every `STACKS` entry has a template directory — a name without templates would otherwise scaffold a base-only tree and report success.

## Decisions

Every non-trivial change adds or updates a decision record in the same change — see [.agents/notes/README.md](.agents/notes/README.md). Adding a gate, adding or changing a layer, or altering what the CLI refuses are all non-trivial.

## Checks

```sh
npm test              # scaffolding behaviour, and one negative control per gate
npm run check         # the shipped gates, against every composed layer combination
npm run format:check  # Prettier layout
```

All three must pass before a change is reported as done; report the actual result, failures included.
