# Decision Record: TypeScript projects are initialised, not just annotated

Status: implemented

## Problem

The `typescript` layer shipped standing orders that assume a `tsconfig.json` — `strict` is on, modules are ESM, relative imports carry `.js` — and a gate that resolves `typescript` from the repository, but the layer provided neither. Scaffolding `--stack typescript` into a fresh directory produced a tree whose own standing orders were unenforceable and whose documented gate failed loud on the first run: no config to read and no compiler to resolve. On an existing project the layer was silent about a config that contradicted those orders, and a `CommonJS` module setting or `strict` off is exactly what the JSDoc gate cannot see and no typecheck gate existed to catch.

## Decision

`--stack typescript` initialises the parts of the toolchain its rules depend on, and repairs nothing silently.

- **No `tsconfig.json`** → the layer writes a strict ESM Node config. That file is the specification: the init-time comparison and its recommendation both read it.
- **No `package.json`** → one is created carrying the gate scripts, `typecheck`, and `typescript` in `devDependencies`. A repository that has one is extended add-only, so an existing `typecheck` script or a pinned compiler version is never replaced. The run prints the `npm install` command rather than running it.
- **An existing `tsconfig.json`** is not rewritten by an ordinary run; only `--force`, which replaces every written file, touches it. It is read as JSONC and the run reports every option the orders assume but the file does not set, every value that differs from the recommendation, and which recommended options are absent. A `package.json` whose `type` is not `module` is reported on the same terms, because Node reads a `.ts` file as ESM only when the package says so. The setup skill tells the agent to ask the user before editing, and to edit in place so comments survive.
- **A new `verify-typescript-types.mjs` gate** runs the project's own `tsc --noEmit` against its `tsconfig.json`, in the `full` group and advisory like every stack gate. It fails loud when the config or the compiler is missing, and checks nothing when the repository holds no TypeScript file.

## Alternatives considered

**Compose the config with a `.merge` template.** The mechanism exists and creates the file when absent. Rejected because a merge replaces a key both sides hold, which would overwrite a deliberate `target` or `module` choice, and because a JSON round-trip drops the comments a real `tsconfig.json` carries.

**Rewrite the config behind a `--fix-config` flag.** Would make repair one command. Rejected because a flag cannot ask the question, so the destructive step becomes the default path for anyone clearing findings; a person answering first is the consent.

**Add `typescript` as a devDependency of this package so the gate can be tested against a real compiler.** Rejected because this repository runs its whole suite with no install step and no dependency tree, and a compiler this package owned would not be the project's own.

**Run `npm install --save-dev typescript` during scaffolding.** Rejected because the scaffolder would reach the network and write `node_modules`; the declared entry plus the printed command leaves the decision with the user.

## Consequences

A fresh TypeScript repository is coherent on the first run: the orders, the config, the declared compiler, and the gate that runs it all agree. The cost is that the tool is no longer wholly language-neutral — it writes a language-specific config — and `docs/design.md` now says so.

An existing project gets an accurate report and no edits, so adopting the stack cannot break a build; the repair is one conversation away. The typecheck gate is advisory and `full`-only, so a repository adopting the stack does not get a type failure on every commit before it has cleared the debt and tightened the gate.

`README.md`'s ceiling rose from 1400 to 1550 words to document the feature. That is the one non-mechanical reason this change touches the package's own budget manifest, and it follows the manifest's own rule that a ceiling too low to hold a real document is a budget bug.

## Related

Why a stack gate delegates to the language's own tooling rather than parsing is in [Stack gates delegate to language tooling](../architecture/2026-09-16-stack-gates-delegate-to-language-tooling.md). What a layer may add, and how, is in [Layer stack profiles as additive overlays](../architecture/2026-09-15-layer-stack-profiles-as-overlays.md).
