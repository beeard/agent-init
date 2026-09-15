# Deliberate omissions

Concepts from the reference implementation that `agent-init` does **not** ship, with what each one does there and the condition under which a project would want it.

This exists so the omission is a recorded decision rather than an oversight. A maintainer who wonders "should we adopt X?" finds X here, learns what problem it solved, and can tell whether they have that problem.

Each entry names the mechanism, states how it helps, and gives the trigger. An entry with no plausible trigger should be deleted, not kept as trivia.

## Package and module boundaries

**Registry dependencies pinned at every boundary.** The reference makes one framework package a `peerDependency` *and* a dev dependency of every package, so no package can resolve a second copy of the shared runtime. *Helps:* a duplicated framework instance means two service registries and two event buses, which fails in ways that look like application bugs. *Trigger:* a monorepo where two workspaces could otherwise install different versions of a shared runtime.

**A declared source plane versus artifact plane.** Static checks and tests resolve workspace imports to `src` through TypeScript `paths` and must pass on a clean tree; checks that consume built output declare that dependency explicitly. *Helps:* it prevents "works because I built it earlier" from becoming a passing gate, which is the failure that makes a green CI run meaningless. *Trigger:* a repository that both type-checks sources and ships built artifacts, where a gate could accidentally read the stale artifact.

**Compiler faces kept explicit.** A package with distinct host and browser programs exposes separate leaf configs and a solution-only root. *Helps:* it keeps one program's globals from leaking into another's type space, which is otherwise discovered as a mystery type error. *Trigger:* a package compiled for two runtimes from one source tree.

## Identity and typing at boundaries

**Branded opaque identifiers.** An id that crosses a boundary is a branded type rather than a bare `string`, so an agent id cannot be passed where a session id is expected. *Helps:* it turns an argument-order mistake into a compile error instead of a runtime lookup that silently returns nothing. *Trigger:* two or more id types that are structurally identical strings and flow through the same functions.

**Runtime invariants for owned relationships.** A package may publish an `./invariant` companion that asserts a relation only it can observe. *Helps:* it catches a broken invariant at the moment it breaks rather than three layers downstream, where the symptom is unrecognizable. *Trigger:* a relationship between two pieces of state that no single function's postcondition can express.

**Trust the type system inside one process.** No runtime validation for values the static interface already guarantees; validation belongs at the parser, wire, file, worker, and process boundaries. *Helps:* it keeps validation where untrusted data actually enters, instead of scattering defensive checks that imply the types are not trustworthy and cost performance everywhere. *Trigger:* a typed codebase where reviewers are adding runtime checks for internally-produced values.

## Documentation and translation

**A generated reference tier.** Catalogs of tools, configuration, events, and module graphs are generated from source and freshness-gated in CI. *Helps:* a hand-maintained catalog is correct on the day it is written and wrong thereafter, and its wrongness is invisible because nothing compares it to the source. *Trigger:* any list a machine could derive from code — tool schemas, configuration keys, exported symbols, dependency edges.

**Bilingual documentation with a pairing contract.** Every document has a counterpart in a second language, and a gate checks that the pair stays structurally aligned. *Helps:* it makes translation a maintenance obligation with a check rather than a one-time effort that decays. *Trigger:* a project whose contributors or users read more than one language, with enough documentation that drift matters.

**Verbatim type documentation (`ts type-equiv`).** A pasted type declaration in a document is marked so a gate can compare it to the source and fail when they diverge. *Helps:* it lets documentation show exact types without the copy silently going stale. *Trigger:* reference documentation that quotes type signatures.

## Testing and evidence

**A recorded-session snapshot tier.** Model- or user-visible behavior is pinned by a committed transcript that replays without network access and is compared byte-for-byte. *Helps:* it catches a change to what the user actually sees, which unit tests structurally cannot, and it runs in CI without credentials. *Trigger:* a product whose output is generated text or a rendered interface, where the visible result is the contract.

**Test-tier separation by launch mode.** Subprocess tests run the built artifact under plain runtime, while source regressions use their declared launcher, and the two are never mixed. *Helps:* it catches the class of bug that only exists in the built form — a missing export, a path that only resolves in development. *Trigger:* a project that ships a built artifact and tests the source.

**Coverage as a per-file gate.** Every source file must reach full coverage, so a new file with no tests fails rather than being absorbed into a repository-wide average. *Helps:* a repository-wide percentage hides the one new file nobody tested. *Trigger:* a project where a global coverage number has stopped changing behavior.

## Product and UI concerns

**Locale-owned user-facing copy.** Product text goes through a typed dictionary, and a gate rejects a hardcoded string in the interface. *Helps:* it makes translation possible later without an archaeology pass through the codebase. *Trigger:* a user interface that may ever need a second language, or where copy is reviewed by someone who does not read the code.

**Tool presentation designed up front.** Each model-facing tool declares its user-interface presentation at design time, with presenters kept pure and cards derived from raw events. *Helps:* it prevents the interface from being retrofitted around whatever the tool happened to return. *Trigger:* an agent product where tool output is shown to a person.

**A defense-in-depth default posture.** A shipped profile excludes opt-in capabilities, and an agent must justify adding one to the default. *Helps:* it keeps a growing feature set from silently widening what runs without a user asking. *Trigger:* a product with a plugin ecosystem and a default configuration users rarely change.

## Release and distribution

**Vendored dependencies with a pinned manifest.** Copied upstream source records its version and local modifications, and a gate rejects an edit to vendored code that does not update the manifest. *Helps:* it keeps a fork honest — without the manifest, a local patch is lost at the next sync and nobody knows it existed. *Trigger:* any vendored or forked dependency.

**A single supported application entry point.** Every shipped application starts at one launcher with a named profile; a gate rejects a package binary or demo that bypasses it. *Helps:* it guarantees every deployment path is configurable and tested, instead of accumulating launch modes that drift. *Trigger:* a project with more than one way to start it.

**A declared platform matrix.** Which platforms each check runs on is stated, and pull requests run a subset while the full matrix runs on the main branch. *Helps:* it makes the difference between "untested here" and "tested and passing" explicit rather than assumed. *Trigger:* a project supporting more than one operating system.

## What this list is not

These are not ranked by value, and none is recommended by default. Each solves a problem that a project either has or does not: adopting branded identifiers without two confusable id types adds ceremony, and adopting a snapshot tier without generated output adds a fixture nobody reads.

The `base` layer carries what applies everywhere. Everything above waits for its trigger.
