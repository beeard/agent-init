# Testing

How tests are written and run in {{PROJECT}}. The general evidence rules are in [AGENTS.md](../AGENTS.md#evidence); this document covers what is specific to TypeScript.

## Layout

Tests live beside the source as `<module>.test.ts`, so a module and its tests move together and a deletion takes both.

```text
src/
  store.ts
  store.test.ts
  parser.ts
  parser.test.ts
```

Build output and dependency directories are already excluded by the gate configuration; add any other generated directory there rather than committing a test against it.

## Running

Use the runner the project declares in `package.json`. Select the smallest set that covers the change: one file while iterating, the owning module's tests plus each consumer's when a shared contract changes.

Do not run the whole suite to be safe. A suite nobody trusts to be fast is a suite that gets skipped, and a skipped suite enforces nothing.

## What a test must own

A test that passes only when run alone is a defect in the test. Most runners share a process or a worker pool across files, so anything module-level is shared state:

- **Time.** `Date.now()`, `new Date()`, and `performance.now()` make a test depend on when it ran. Use the runner's fake timers, or inject the clock. A test asserting on a duration fails on a loaded machine.
- **Module-level mutable state.** A module that caches, memoizes, or accumulates is shared by every test in the file and often by tests in other files. Export a factory and construct a fresh instance per test, or reset explicitly in `beforeEach`.
- **Randomness.** Seed it, or inject the generator. An unseeded test that fails once a month is worse than no test.
- **The filesystem.** Use a per-test temporary directory and remove it in teardown. Never write to the working directory, and never assume a path is absent because it was absent last run.
- **The network.** Mock at the boundary the code owns — the function that performs the call — not by intercepting a library's internals. A test that patches `fetch` globally leaks into every other test in the file.

## Assertions

Assert on the value, not a property of it, whenever the whole value is known. `expect(result).toEqual(expected)` is stronger than checking three fields, and it fails with the actual difference.

Test the failure path explicitly:

```ts
await expect(load('missing.json')).rejects.toThrow('ENOENT')
```

The message matters. Without it the test passes when the code rejects with the right error type for the wrong reason, which is the most common way a failure-path test silently stops testing anything.

Prefer `rejects.toThrow` over a bare `try`/`catch` with an assertion inside it: the assertion in a `catch` never runs when nothing throws, so a test that should have failed passes.

## Naming

A test name describes the behavior, not the method:

```ts
it('rejects an expired token')          // behavior
it('returns false from validate')       // restates the method
```

A test that asserts the implementation matches itself proves nothing. If a test has to change every time the implementation is refactored without changing behavior, it is testing the implementation.

## Types in tests

Tests are held to the same type checking as the source; a test that compiles only because it casts is hiding a real mismatch. Do not reach for `as any` to build a fixture — construct the value at its declared type, so the test breaks when the type changes.

## Doc comments

Tests are exempt from the JSDoc gate: a test's name is its documentation. Add a comment only when the test encodes a non-obvious reason to exist — a regression it pins, or a boundary it guards.
