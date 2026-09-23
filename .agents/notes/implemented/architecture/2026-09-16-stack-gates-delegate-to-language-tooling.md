# Decision Record: Stack gates delegate to the language's own tooling

Status: implemented

## Problem

A stack profile adds a gate that enforces a rule the language community already agrees on: Python's docstrings, Go's doc comments, Rust's `missing_docs`, TypeScript's JSDoc.

The obvious implementation is a regular-expression scan over declaration lines. It is dependency-free, fast, and wrong.

A regex over `export function` lines cannot tell a declaration wrapped across several lines from two declarations, cannot see that a comment is detached from the item it appears to document by a blank line, and cannot distinguish a real `pub fn` from one inside a comment or a string. The failure mode is not a missed finding — it is a *wrong* finding, which is worse: it teaches the reader that the gate is unreliable, and a gate whose output is not trusted is not run.

Each language also already ships a correct parser. Python has `ast`. Go has `go/parser` and `go/ast`. Rust has `missing_docs` as a built-in rustc lint. TypeScript has the `typescript` package. Reimplementing any of them in JavaScript would be a second, worse version of something already installed on the machine.

## Decision

Every stack gate delegates to the target language's own tooling, and none of them parses the language itself.

- **Python** — `verify-python-docstrings.mjs` runs a small `ast` program through the target repository's `python3`.
- **Go** — `verify-go-docstrings.mjs` runs `go run go-docstrings.go`, a `go/parser` program carrying `//go:build ignore` so it stays out of `go build ./...` and `go vet ./...`.
- **Rust** — `verify-rust-doc-comments.mjs` runs `cargo check --message-format=json` and filters the diagnostics to the `missing_docs` lint code.
- **TypeScript** — `verify-typescript-doc-comments.mjs` resolves the `typescript` package from the target repository's own `node_modules` and walks the AST.

Each gate therefore introduces a toolchain dependency, which only applies when that stack is applied. Each fails loud when the toolchain is missing, naming what is absent and how to opt out, and never reports a clean run it did not perform.

Two consequences follow from using the language's tooling rather than scanning text:

**The Rust gate verifies its own check is enabled.** `missing_docs` is a rustc lint that fires only for a crate that opts in with `#![warn(missing_docs)]`. A gate that ran `cargo check` and reported the absence of diagnostics would report success for every crate that never enabled the lint — a clean run that means nothing. The gate therefore reads each crate root resolved through `cargo metadata`, and fails loud when the attribute is absent. It does not add `RUSTFLAGS`, because a changed `RUSTFLAGS` invalidates cargo's incremental cache and would make the flag unusable next to an ordinary `cargo check`.

**The Rust gate is registered in the `full` group only.** `missing_docs` is a per-crate lint: it cannot be evaluated for one file, and the crate cannot be checked without compiling what it depends on. The `commit` group's contract is a hook that stays fast on every commit, and a crate compile does not meet it. The gate still honors `--staged` by filtering its report, so a repository with a small crate can move it to `commit` in `gates.json` and get correct behavior; the manifest documents that as supported.

The Go gate needed one workaround worth recording. `go run program.go a.go b.go` reads *every* `.go` argument as a source file and fails with "named files must all be in one directory". Separating them with `--` fixes the toolchain's parsing but arrives at the program as a literal `"--"` argument, so the program skips a leading separator. That is two lines rather than compiling to a temporary binary, which would need its own path management and cleanup.

## Alternatives considered

**Scan declaration lines with a regular expression.** No toolchain dependency at all, which would make the gates work on any machine. Rejected because the findings would be wrong rather than merely incomplete, and a gate that produces false findings is worse than no gate: it consumes reviewer attention and trains people to ignore the output. The project's own rules forbid a silent or misleading skip, and a wrong finding is a loud version of the same failure.

**Write one parser in JavaScript and share it across the gates.** Would give one dependency-free implementation instead of four toolchain integrations. Rejected because it is four parsers wearing one coat. The grammars differ completely, and a partial implementation of each is exactly the failure mode already rejected above — the shared code would be cosmetic.

**Have the Rust gate pass the lint explicitly with `RUSTFLAGS="-W missing_docs"`.** Would work on any crate without requiring the attribute, so no crate could silently pass. Rejected because `RUSTFLAGS` is part of cargo's build fingerprint: setting it invalidates the incremental cache, so the gate would force a full rebuild on every run and would also invalidate the cache a developer's ordinary `cargo check` had just populated. Requiring the attribute puts the check where Rust puts it — in the crate — and the gate's own verification of that attribute removes the silent-pass risk that made explicit flags attractive.

**Require the attribute without verifying it.** Simpler: read nothing, run `cargo check`, report the diagnostics. Rejected because a crate without the attribute produces no diagnostics, and an empty report is indistinguishable from a clean one. The gate would report success on precisely the repositories that had not adopted the rule, which is the failure it exists to prevent.

**Register the Rust gate in `commit` like the others.** Consistent with every other gate, and the finding would then be caught on commit rather than at push. Rejected because the `commit` group's stated contract is a hook that stays fast, and a gate that compiles a crate violates it. A hook that takes seconds gets bypassed with `--no-verify`, and a bypassed gate enforces nothing — so consistency here would cost the enforcement it was meant to provide.

**Pass the Go file list over stdin instead of as arguments.** Would avoid the `--` workaround entirely and handle any number of files. Rejected as more moving parts for no gain: the argument interface is already documented in the program, and skipping a leading separator is smaller than changing how both sides communicate.

## Consequences

A stack profile is now a directory plus a name in `STACKS`. The CLI, the merge machinery, the budget manifests, and the dogfood check handled the three new layers without changes, which is the property the layer design was built for.

`npm run check` composes every layer combination — base alone, each of the four stacks alone, architecture alone, and every stack with architecture — through the real scaffolder and runs the shipped gates on the result. Ten combinations, all passing.

The cost is that these gates are the only part of the package that needs something installed beyond Node. That is a real reduction in reach: `base` runs anywhere Node runs, and a stack gate does not. It is accepted because a stack profile is meaningless without the language it describes, and a machine building Go already has Go.

A second cost is that the Rust gate is slower than every other gate by an order of magnitude, and its placement in `full` means a Rust repository's pre-commit hook does not catch an undocumented item. The finding arrives at push instead. That is the honest trade for a hook that keeps running.

A third cost is uneven coverage across languages. Python, Go, and TypeScript check every declaration form the gate can enumerate; Rust reports what rustc reports, which is the crate's publicly reachable API and nothing else — an orphan `.rs` file the crate never declares is invisible, because it is not part of the crate. That is Rust's own module rule rather than a gap in the gate, and a test pins it so the behavior is recorded rather than rediscovered.

## Related

The Rust gate no longer checks for the lint attribute; it passes the lint to the compiler itself. See [The Rust gate hands the lint to the compiler](../bug-fix/2026-09-23-the-rust-gate-hands-the-lint-to-the-compiler.md), which partly supersedes this record's Rust paragraphs.
