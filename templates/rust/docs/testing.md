# Testing

How tests are written and run in {{PROJECT}}. The general evidence rules are in [AGENTS.md](../AGENTS.md#evidence); this document covers what is specific to Rust.

## Layout

Unit tests live in the module they test, behind `#[cfg(test)]`, so they can reach private items. Integration tests live under `tests/` at the crate root, where each file is its own crate and can only see the public API.

```text
src/
  store.rs          # #[cfg(test)] mod tests { ... }
tests/
  store.rs          # public API only
```

That boundary is the point: a unit test proves a function works, and an integration test proves the crate is usable from outside. A test that only compiles because it lives beside the code is testing an implementation, not a contract.

## Running

```sh
cargo test                 # everything
cargo test --lib           # unit tests only
cargo test --test store    # one integration file
cargo test expiry          # tests whose name contains "expiry"
cargo test -- --nocapture  # show stdout from passing tests
```

Run `cargo test` under `--release` when the behavior depends on timing, and run `cargo miri test` for anything exercising `unsafe`. Miri catches undefined behavior that the ordinary test run cannot.

## What a test must own

Tests run in parallel threads within one process by default, so anything global is shared state:

- **Time.** Never call `SystemTime::now()` in code a test exercises directly. Inject the clock, or take a duration. The standard library has no way to pause time in stable Rust, so injection is the only option — design for it.
- **Filesystem.** Use the `tempfile` crate, which removes the directory when the guard drops even if the test panics. Never write to the working directory, and never assume a path is absent because it was absent last run.
- **Environment.** `std::env::set_var` is process-global and, in Rust 2024, `unsafe`. Prefer threading configuration through a parameter over reading the environment inside the code under test.
- **Shared mutable state.** A `static` or a lazy singleton is shared by every test in the binary. Make it a field on a struct the test constructs.
- **The network.** Bind a listener on port `0` and read back the assigned port rather than hardcoding one — a fixed port makes the test fail when two runs overlap.

### Tests that must not run in parallel

A test that cannot tolerate concurrency is a test whose isolation is incomplete. When you truly cannot avoid it — a fixed port, a process-wide handle — serialize it explicitly and say why, rather than hoping the scheduler cooperates.

## Assertions

Prefer `assert_eq!` and `assert_ne!` over `assert!`: they print both values on failure, which is the whole diagnosis. Add a message when the values alone do not explain the failure.

Return `Result` from a test instead of calling `unwrap()`, so a failure is reported with its source rather than as a panic with no context:

```rust
#[test]
fn rejects_expired_token() -> Result<(), ParseError> {
    let error = parse("expired").unwrap_err();
    assert_eq!(error.kind(), ErrorKind::Expired);
    Ok(())
}
```

Test the panic path with the expected message, so a panic for the wrong reason fails the test:

```rust
#[test]
#[should_panic(expected = "unknown mode")]
fn rejects_unknown_mode() {
    parse("nonsense").unwrap();
}
```

Without `expected`, the test passes when the code panics for any reason at all — including a bug in the test itself.

## Naming

A test name describes the behavior, not the method:

```rust
fn rejects_an_expired_token()      // behavior
fn test_validate_returns_false()   // restates the method
```

The `#[cfg(test)]` module already marks it as a test; a `test_` prefix adds nothing and obscures the behavior being described.

## Doc comments

Test functions are exempt from the doc-comment gate: the test's name is its documentation. Add a comment only when the test encodes a non-obvious reason to exist — a regression it pins, or a boundary it guards.
