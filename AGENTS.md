# AGENTS.md

Standing orders for agents working on `agent-init`. This repository uses the structure it ships, so the rules below are the same ones it writes into other repositories. `CLAUDE.md` is a symlink to this file — edit `AGENTS.md`, never the link.

## Read before you change

- **Read a file before editing it.**
- **[README.md](README.md) explains the tool**; [docs/design.md](docs/design.md) explains why it is built this way.
- **Everything under `templates/` is product**, not project scaffolding. A template change changes what every receiving repository gets.

## Working method

- **Zero runtime dependencies.** The package uses only the Node standard library. A dependency here would have to be installed before the tool that scaffolds a repository could run.
- **The gates are the specification.** A rule stated in prose in a template must be enforced by a gate in the same template, or it is a suggestion. When the two disagree, the gate is wrong.
- **Every gate needs a negative control.** A check that only ever runs green is untested. `tests/gates.test.mjs` breaks one thing per gate and asserts the rejection.
- **Keep the two layers honest.** `templates/base/` must stand alone; `templates/architecture/` may add to it, never contradict it.
- **Comment the contract, not the reasoning.**

## The dogfood rule

This repository runs its own gates against its own templates:

```sh
npm run check
```

That check scans `templates/**/*.md` with the same walker, the same paragraph rule, and the same link check that a receiving repository gets. If a template would fail the gates in a fresh repository, it fails here first. **A change that makes `npm run check` fail is a defect in the product**, not in the check.

The word budgets in [scripts/gates/doc-budgets.manifest.json](scripts/gates/doc-budgets.manifest.json) cover the templates too, so a template cannot grow past the ceiling it imposes on its receivers.

## Decisions

Every non-trivial change adds or updates a decision record in the same change — see [.agents/notes/README.md](.agents/notes/README.md). Adding a gate, changing a template's structure, or altering what the CLI refuses are all non-trivial.

## Checks

```sh
npm test         # 35 tests: scaffolding behaviour and one negative control per gate
npm run check    # the shipped gates, run against the shipped templates
```

Both must pass before a change is reported as done. Report the actual result, including a failure.
