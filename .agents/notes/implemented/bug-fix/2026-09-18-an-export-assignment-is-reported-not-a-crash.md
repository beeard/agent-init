# Decision Record: An export assignment is reported, not a crash

Status: implemented

## Problem

`verify-typescript-doc-comments` called `ts.isExportEquals(statement)` when naming an `export default` or `export =` declaration. No such function exists on the `typescript` package — the fact lives on the `ExportAssignment` node as the `isExportEquals` property, and the same file already read it that way in `exportAssignmentName`. Any repository holding a `.ts` file with an export assignment therefore crashed the gate with `TypeError: ts.isExportEquals is not a function` instead of reporting the declaration.

It survived because nothing ran it. A composed scaffold carries no `.ts` source of its own, so the dogfood suite checked zero files there, and the only TypeScript doc-comment test covered the missing-compiler path. A gate with no negative control is untested, and this one was.

## Decision

`statement.isExportEquals === true` replaces the call, matching how `exportAssignmentName` reads the same node.

`tests/stack-gates.test.mjs` gains the negative control the gate was missing: a scaffolded TypeScript repository with a real `typescript` linked into its `node_modules`, a `src/provider.ts` that default-exports a value, an assertion that the gate reports it and prints no `TypeError`, and a second assertion that a JSDoc above the export turns the run green. The compiler is resolved from this package's own `node_modules` or from `npm root --global`, which is where continuous integration installs it, and the test skips where neither exists — the convention the Go and Rust gates already use.

## Alternatives considered

**Exercise the branch through the dogfood run instead.** Rejected: the composed scaffold has no `.ts` source, so it would need a file added to the product purely to reach a gate, and the negative control would still be absent where the crash actually happened.

**Stub the compiler, as `stubCompiler` does for the typecheck gate.** Rejected because this gate parses a syntax tree: a `module.exports = {}` stub reaches `createSourceFile` and fails for a different reason, which would test the stub rather than the gate.

**Fix the line and leave the test out.** Rejected by the rule this repository already states — every gate needs a negative control — and this defect is the evidence that the rule earns its place.

## Consequences

A TypeScript repository whose entry point is `export default` or `export =` gets a finding instead of a stack trace. The gate's other branches are unchanged.

The cost is that the new test needs a real compiler and so skips where none is installed, which is the trade every stack gate makes. The skip is not silent: its reason names the missing package.

## Verification

With the fix reverted, the new test fails with `TypeError: ts.isExportEquals is not a function` at [line 273](../../../../templates/typescript/scripts/gates/verify-typescript-doc-comments.mjs); with it in place, `npm test` and `npm run check` pass.

## Related

Partially supersedes [The dogfood run exercises every gate](../process/2026-09-17-the-dogfood-run-exercises-every-gate.md). That record assigned the TypeScript analysis to the stack tests because the dogfood run ships no compiler; the test added here is what carries it there now, and the coverage sentence in that record is corrected in place rather than superseded outright.
