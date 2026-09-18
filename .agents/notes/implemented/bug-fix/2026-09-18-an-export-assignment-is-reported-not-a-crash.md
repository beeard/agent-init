# Decision Record: An export assignment is reported, not a crash

Status: implemented

## Problem

`verify-typescript-doc-comments` named an `export default` or `export =` declaration by calling `ts.isExportEquals(statement)`. No such function exists on the `typescript` package — the fact is the `isExportEquals` property on the `ExportAssignment` node, and the same file already read it that way in `exportAssignmentName`. Any repository holding a `.ts` file with an export assignment crashed the gate with `TypeError: ts.isExportEquals is not a function` instead of reporting the declaration.

`loadCompiler` had the same shape of hole one level up. It accepted whatever `require('typescript')` returned, so a package whose root does not carry the compiler API — TypeScript 7 exports only its version there — passed the load and then failed on `ts.ScriptKind` while walking the first file.

Both survived because nothing ran the analysis. A composed scaffold carries no `.ts` source of its own, so the dogfood suite checked zero files there; the only TypeScript doc-comment test covered the missing-compiler path; and continuous integration installed `typescript` unpinned, which now resolves to a major version this gate cannot use. A gate with no negative control is untested, and this one was.

## Decision

`statement.isExportEquals === true` replaces the call, matching how `exportAssignmentName` reads the same node.

`loadCompiler` refuses a module that does not expose `createSourceFile` and reports it as an unloadable compiler, so the failure stays at the load, where it names the problem, instead of deep inside the walk. The gate's existing missing-toolchain message already tells the reader how to install one.

`tests/stack-gates.test.mjs` gains the negative control the gate was missing: a scaffolded TypeScript repository with a real compiler linked into its `node_modules`, a `src/provider.ts` that default-exports a value, an assertion that the gate reports it and prints no `TypeError`, and a second that a JSDoc above the export turns the run green. The compiler resolves from this package's own `node_modules` or from `npm root --global`, and only one exposing the compiler API is linked — a TypeScript 7 install is passed over rather than linked into a gate that refuses it. The test skips where no usable compiler exists, the convention the Go and Rust gates already use.

The workflow's global install is pinned to `typescript@^5.6.0`, the range the TypeScript scaffold declares for a receiving repository, so the control runs in continuous integration instead of being skipped for a compiler the gate must refuse.

## Alternatives considered

**Exercise the branch through the dogfood run instead.** Rejected: the composed scaffold has no `.ts` source, so it would need a file added to the product purely to reach a gate, and the negative control would still be absent where the crash actually happened.

**Stub the compiler, as `stubCompiler` does for the typecheck gate.** Rejected because this gate parses a syntax tree: a `module.exports = {}` stub reaches `createSourceFile` and fails for a different reason, which would test the stub rather than the gate.

**Support TypeScript 7's `unstable/*` API.** Rejected for now, not dismissed: it is a different API surface behind deliberately unstable subpaths, so adopting it is a product decision about which compiler the layer targets, not a correction to a gate. Refusing it loudly is the honest state until that decision is taken.

**Install TypeScript inside the test.** Rejected: this package has no dependencies and its tests do not reach the network. Linking a compiler that is already installed is what keeps that true.

**Fix the line and leave the test out.** Rejected by the rule this repository already states — every gate needs a negative control — and this defect is the evidence that the rule earns its place.

## Consequences

A TypeScript repository whose entry point is `export default` or `export =` gets a finding instead of a stack trace, and a repository on a compiler the gate cannot use gets a message naming that instead of a failure inside its own walk.

The cost is that the new test needs a real compiler and so skips where none is installed, which is the trade every stack gate makes. The skip is not silent: its reason names what is missing. Continuous integration now tests the gate against the compiler major the layer declares rather than whichever one `latest` happens to be, so a future major is not discovered by the gate crashing on it.

## Verification

With the fix reverted, the new test fails with `TypeError: ts.isExportEquals is not a function` at [line 273](../../../../templates/typescript/scripts/gates/verify-typescript-doc-comments.mjs); with it in place, `npm test` and `npm run check` pass, and continuous integration runs the TypeScript control rather than skipping it.

## Related

Partially supersedes [The dogfood run exercises every gate](../process/2026-09-17-the-dogfood-run-exercises-every-gate.md). That record assigned the TypeScript analysis to the stack tests because the dogfood run ships no compiler; the test added here is what carries it there now, and the coverage sentence in that record is corrected in place rather than superseded outright.
