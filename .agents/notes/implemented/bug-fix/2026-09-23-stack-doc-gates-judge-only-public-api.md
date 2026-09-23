# Decision Record: Stack doc gates judge only public API in the shared corpus

Status: implemented

## Problem

The Python, Go, and TypeScript documentation gates each reported code that is not public API, or missed code that is.

Every one built its file selector from its own `*SkipDirectories` key alone. The shared `skipGlobs`, where a repository names a generated or frozen region once for every gate, was ignored, and so were the build and dependency directories the base gates skip by default. A `node_modules/**/*.py` or a vendored Go file under `node_modules` was reported as the repository's own code. `verify-typescript-types` had the same selector.

The Python analysis descended into every class, so `class _Hidden: def helper()` reported `helper` although nothing outside the module can reach it.

The Go gate analyzed `_test.go` files. `func TestAdd(t *testing.T)` was reported as an undocumented exported function, and an external `package demo_test` file was reported for having no package comment. The Go testing guide already said test functions were exempt.

The TypeScript gate reported every overload signature and the implementation separately. The JSDoc on the first overload is the one an editor shows for every signature, so documenting it correctly still failed the gate. `export namespace A.B { export function hidden() {} }` was not walked at all, because a dotted name nests a second module declaration as the body of the first, and the walker only descended into a module block.

## Decision

Each stack selector uses the base `corpusSkipPredicate` from `lib/repo-files.mjs` with `REPOSITORY_SKIP_DIRECTORIES` as its default, the same answer `verify-final-newline` and `verify-issue-tags` already use. The shared `skipGlobs`, every layer's `*SkipDirectories`, and the default build and dependency directories exclude a file from every stack gate alike.

The Python analysis descends only into a public class. The members of a private class are private with it.

The Go selector leaves out every `_test.go` file. Go compiles it only into the test binary, so nothing in it is part of the package another package imports. The sibling scan for a package comment already ignored test files.

The TypeScript walker treats consecutive function declarations of one name as a single overload group and judges it once, by its first declaration: documented if that declaration carries JSDoc, reported once at its line otherwise. A module declaration is followed through nested declarations to its innermost block. The namespace is reported under its full dotted name, and the block's members are walked with the ambient flag of any level.

## Alternatives considered

**Keep each gate's own skip list and add `skipGlobs` to it.** Rejected: the base already has one predicate for this question so that two gates cannot disagree about what a directory means, and a fourth hand-written copy is how the three copies drifted.

**Exempt Go test functions by name, `Test*`, `Benchmark*`, `Fuzz*`, `Example*`.** Rejected: helpers and types in a test file are not public API either, and an external test package would still need a package comment. The file is the unit Go itself uses.

**Judge an overload group as documented when any member carries JSDoc.** Rejected: JSDoc on a later signature or on the implementation is not what an editor shows for the first signature, so the group would pass while its first signature stayed undocumented to every caller.

## Consequences

A dependency tree, a generated region named in `skipGlobs`, a private class's methods, a Go test file, and the extra signatures of an overload no longer produce findings, and a member of a dotted namespace now does. Each of these was a finding either wrong or missing, and a gate whose findings are wrong is a gate nobody runs.

The cost is that a stack gate's corpus now shrinks when another layer adds a `*SkipDirectories` entry. That is the shared-predicate contract the base gates already follow, not a new one.

## Verification

`tests/stack-gates.test.mjs` carries a negative control for each: Go test files, internal and external, pass; a Go and a Python file under `node_modules` or a `skipGlobs` region pass while the same file elsewhere is reported; `class _Hidden` passes while the same method on a public class is reported; a documented overload group passes, and an undocumented one is one finding at line 1; a dotted namespace's undocumented member is reported, and an undocumented `namespace A.B` is reported under that name; a TypeScript file under a `skipGlobs` region passes while its copy in `src/` is reported. With the previous gates each of those controls fails. A basic control that an undocumented exported function and class are rejected by the TypeScript gate is added as well, since none existed.

## Related

Applies the shared predicate described in [A gate's corpus comes from the configuration](../architecture/2026-09-16-a-gates-corpus-comes-from-the-configuration.md) to the stack gates.
