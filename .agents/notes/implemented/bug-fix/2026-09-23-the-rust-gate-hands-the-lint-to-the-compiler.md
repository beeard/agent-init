# Decision Record: The Rust gate hands the lint to the compiler

Status: implemented

## Problem

`verify-rust-doc-comments` had three defects, each of which let a crate pass or fail for the wrong reason.

A crate that did not compile passed. The gate treated a failed `cargo check` as fatal only when stdout was empty, but with `--message-format=json` the compile errors arrive on stdout, so the run fell through, found no `missing_docs` diagnostics, and reported every public item documented.

Whether the lint was enabled was decided by a regular expression over the crate root. A commented-out `// #![warn(missing_docs)]` satisfied it, so the check was silently off. `#![warn(missing_docs, unused)]` and `[lints.rust] missing_docs = "warn"` in `Cargo.toml` both failed it, although the compiler enforced the lint in both. It also accepted `clippy::missing_docs`, a lint that does not exist. That is the regular-expression reading of Rust this repository forbids, applied to the gate's own precondition.

A plain `cargo check` in a root package compiles only that package, so the members of a workspace with a root package were never checked.

## Decision

The gate passes the lint to the compiler instead of verifying that the crate enabled it. For every library and binary target of every workspace member listed by `cargo metadata --no-deps`, it runs `cargo rustc --package <name> --lib|--bin <name> --profile check --message-format=json -- -W missing_docs`. The lint runs whether or not the crate root carries an attribute, so no crate can pass by never having opted in, and the regular expression is gone.

An error-level diagnostic other than `missing_docs` means the target did not compile, and the gate fails with the compiler's rendered errors, the first five quoted and the rest counted. A crate that writes `#![deny(missing_docs)]` fails its compile with nothing but lint errors. Those are findings, not a compile failure. A non-zero exit with no diagnostics at all, a spawn error, or a signal is surfaced as a failure with cargo's stderr. The success line counts targets checked.

A crate that writes `allow(missing_docs)` in its own source keeps it: a command-line `-W` sits below a source attribute, and an `allow` in the source is a visible decision a reviewer can see.

The Rust `AGENTS.md` order now says the lint is enforced on every workspace member and that the attribute adds the same warning to the developer's own `cargo check`.

## Alternatives considered

**Keep the attribute requirement, verified from compiler output instead of a regex.** Rejected: to prove the lint is on, the gate would have to observe it firing, which a fully documented crate never does. It would need a probe item compiled into the crate, which is more machinery than simply turning the lint on.

**`RUSTFLAGS="-W missing_docs"` or `--config build.rustflags`.** Rejected, as the [stack gates record](../architecture/2026-09-16-stack-gates-delegate-to-language-tooling.md) already rejected it, for the cache cost. It also replaces or is replaced by other flag sources: `RUSTFLAGS` overrides a repository's `build.rustflags`, and `target.<triple>.rustflags` silently overrides `build.rustflags`, so the lint could vanish without a word. Arguments after `cargo rustc --` reach only the target being judged and combine with every other flag source.

**`--force-warn missing_docs`.** Rejected: it overrides a local `#[allow(missing_docs)]` too, leaving no escape hatch short of removing the gate.

**`cargo check --workspace` and keep the attribute.** Rejected: it fixes the workspace defect and leaves the regular expression in place.

## Consequences

The gate cannot be switched off by an attribute that is missing, misspelled, or commented out, and it cannot report a clean run for a crate that does not compile. Every workspace member is judged.

The cost is one `cargo rustc` spawn per target instead of one `cargo check`. Dependencies are compiled once and shared. The judged crates themselves are rechecked whenever the developer alternates between the gate and a plain `cargo check`, because the extra argument is part of those targets' fingerprint. For a crate that is a check, not a build, and it is the price of not touching the flags the rest of the build uses.

## Verification

`tests/stack-gates.test.mjs` carries a negative control for each defect: a commented-out attribute with an undocumented item is reported, and `#![warn(missing_docs, unused)]` on a documented crate passes; a type error fails with `does not compile` and `E0308`; an undocumented item in a member of a root-package workspace is reported at `member/src/lib.rs:3`. A fourth test pins the deny branch: `#![deny(missing_docs)]` reports findings, not a compile failure. With the previous gate the first three fail and the fourth passes.

## Related

Partially supersedes [Stack gates delegate to language tooling](../architecture/2026-09-16-stack-gates-delegate-to-language-tooling.md): its paragraph on the Rust gate verifying the attribute, and its rejection of explicit flags, are replaced here. The rest of that record stands.
