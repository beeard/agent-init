# Testing

How tests are written and run in {{PROJECT}}. The general evidence rules are in [AGENTS.md](../AGENTS.md#evidence); this document covers what is specific to Go.

## Layout

Unit tests live beside the code as `<file>_test.go` in the same package, so they can reach unexported identifiers. Integration tests live under `tests/` in package `main` or a `_test` package, which is the boundary that proves the public API is usable on its own.

```text
store.go
store_test.go        # same package: reaches internals
tests/
  store_test.go      # external package: public API only
```

A test that only compiles because it lives in the same package is testing an implementation, not a contract. When both would work, prefer the external package: it fails when the public surface becomes unusable.

## Running

```sh
go test ./...              # everything
go test ./store            # one package
go test -run TestExpiry    # by name
go test -race ./...        # with the race detector
```

Run `-race` before pushing anything touching concurrency, shared state, or a goroutine's lifetime. A race that only appears under load is a race that appears in production.

## Table-driven tests

Write a table when several inputs exercise one behavior. The table makes the cases visible and the failure message names which one broke:

```go
tests := []struct {
    name  string
    input string
    want  int
}{
    {"empty", "", 0},
    {"single", "a", 1},
}
for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) {
        if got := count(tt.input); got != tt.want {
            t.Errorf("count(%q) = %d, want %d", tt.input, got, tt.want)
        }
    })
}
```

`t.Run` gives each case its own test name, so a failure points at the case rather than the loop.

## What a test must own

A test that passes only when run alone is a defect in the test. Go runs tests in the same package in parallel by default, so anything global is shared state:

- **Time.** Never call `time.Now()` in code a test exercises directly. Inject the clock, or pass a duration. A test asserting on elapsed time fails on a loaded CI machine.
- **Filesystem.** Use `t.TempDir()`, which the framework creates and removes per test. Never write to the working directory, and never assume a path is absent because it was absent last run.
- **Environment.** `t.Setenv` restores the previous value and marks the test as non-parallel; assigning `os.Setenv` directly does neither.
- **Global variables and singletons.** A package-level cache or connection is shared by every test in the package. Make it a field on a struct the test constructs.
- **The network.** Use `net/http/httptest` for HTTP rather than a real endpoint or a global patch.

Call `t.Parallel()` only when the test owns everything it touches. Adding it to a test that mutates shared state converts a passing test into an intermittent failure.

## Assertions

Go has no assertion library in the standard library, and a table test with `t.Errorf` is usually clearer than one imported dependency.

Test the failure path explicitly, and assert on the error rather than its absence:

```go
_, err := Load("missing.json")
if !errors.Is(err, fs.ErrNotExist) {
    t.Fatalf("Load() error = %v, want fs.ErrNotExist", err)
}
```

`errors.Is` is why wrapping with `%w` matters. A test that only checks `err != nil` passes when the code fails for an entirely different reason.

Use `t.Fatalf` when continuing would panic, and `t.Errorf` when the remaining assertions still mean something.

## Doc comments

Test functions are exempt from the doc-comment gate: the test's name is its documentation. Add a comment only when the test encodes a non-obvious reason to exist — a regression it pins, or a boundary it guards.
