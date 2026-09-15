# AGENTS.md

Standing orders for agents working on `agent-init`. This repository uses the structure it ships, so the rules below are the same ones it writes into other repositories. `CLAUDE.md` is a symlink to this file — edit `AGENTS.md`, never the link.

## Read before you change

- **Read a file before editing it.**
- **[README.md](README.md) explains the tool**; [docs/design.md](docs/design.md) explains why it is built this way.
- **Everything under `templates/` is product**, not project scaffolding. A template change changes what every receiving repository gets.
- **`templates/base/` must stand alone.** The stack and architecture layers add to it and may never contradict it, and none of them may assume a lower layer's entries will stay unchanged — that is what `.merge` templates are for.

## The three template forms

A template file is applied according to its suffix, and the suffix is the whole contract:

| Suffix | Applied as |
|---|---|
| *(none)* | Written. A later layer writing the same path replaces it, so only the last write survives. |
| `.append` | Appended to the named file inside `<!-- agent-init:begin <layer> -->` markers, so a re-run stays idempotent and two layers can both contribute. |
| `.merge` | Shallow-merged into the named JSON object, incoming keys winning, so a layer adds entries without restating the ones below it. |

A layer that restates a lower layer's entries instead of merging goes stale silently the moment the lower layer changes. Manifests — `gates.json`, `config.json`, `doc-budgets.manifest.json` — are `.merge` for exactly that reason.

## Working method

- **Zero runtime dependencies.** The package uses only the Node standard library. A dependency here would have to be installed before the tool that scaffolds a repository could run.
- **The gates are the specification.** A rule stated in prose in a template must be enforced by a gate in the same template, or it is a suggestion. When the two disagree, the gate is wrong.
- **Every gate needs a negative control.** A check that only ever runs green is untested. `tests/gates.test.mjs` breaks one thing per gate and asserts the rejection.
- **Keep the layers honest.** `templates/base/` must stand alone; the stack and architecture layers add to it, never contradict it.
- **A stack layer may only add what is specific to that language.** A rule that holds for Python and Go alike belongs in `base`. The test is whether the rule survives translating it into another language.
- **Comment the contract, not the reasoning.**

## The dogfood rule

This repository runs its own gates against the product it ships:

```sh
npm run check
```

That check applies every layer combination — base, python, architecture, and python with architecture — through the real scaffolder into throwaway directories, and runs the shipped gates on the result. If a template would fail the gates in a fresh repository, it fails here first. **A change that makes `npm run check` fail is a defect in the product**, not in the check.

The combinations matter: a layer checked alone passes trivially, because a layer is a partial overlay whose links are written for the composed tree. Only the composed result is what a receiving repository gets.

## Decisions

Every non-trivial change adds or updates a decision record in the same change — see [.agents/notes/README.md](.agents/notes/README.md). Adding a gate, adding or changing a layer, or altering what the CLI refuses are all non-trivial.

## Checks

```sh
npm test         # scaffolding behaviour, and one negative control per gate
npm run check    # the shipped gates, against every composed layer combination
```

Both must pass before a change is reported as done. Report the actual result, including a failure.
