# Decision Record: A bundler project gets no module findings

Status: implemented

## Problem

`typescriptConfigReport` computed the `bundler` flag but kept reporting every deviation from the template's Node-mode `compilerOptions` as a finding. A `create-next-app` `tsconfig.json` — `module: "esnext"`, `moduleResolution: "bundler"`, `target: "ES2017"` — produced four notes naming those values as deviations from `"NodeNext"` and `"ES2022"`, followed by the bundler note saying the settings above were the framework's to leave alone.

An agent running the setup skill reads findings as work. The session that surfaced this rewrote the framework's `module` and `moduleResolution` to match the recommendations, which is the one change that stops a Next.js project building: `NodeNext` requires `.js` extensions on the extensionless relative imports a bundler resolves. The closing note told the reader not to apply what the opening notes had just reported; the reader applied it anyway.

## Decision

The bundler detection moves ahead of the findings loop, and a bundler project excludes the options in `TYPESCRIPT_MODULE_OPTIONS` — `module`, `moduleResolution`, `target`, `lib` — from `required`, `suggested`, and `conflicts` entirely. The report for a bundler project names only the strictness options, plus the bundler note, which is the only thing the run says about the module system. The note's wording no longer refers to "the settings above", because there are none.

The options stay findings for a non-bundler project, where `NodeNext` is the correct answer and a gap is real. `bundlerBuild` already covered `moduleResolution: "bundler"`, the bundler frameworks in `package.json`, and the framework config files, so the detection needed no change.

## Alternatives considered

**Keep the findings and phrase them as informational.** A `note:` prefix already carries no failure, and it changed nothing: the agent still read them as defects to clear. Severity is a property of the reader, and the reader is an agent that fixes what a report lists.

**Teach the skill to warn the agent.** The defect is in what the tool prints, not in how it is read; a paragraph in `SKILL.md` would leave every other caller — a human running the CLI, a different agent — reading the same wrong findings. The tool produces one report; that report must stand alone.

**Drop only the `conflicts`, keep the `suggested`.** An unset `module` on a bundler project is still reported as a gap, which is the same false work in weaker phrasing. The module system of a bundler app is not a gap at any severity.

## Consequences

A bundler project's run output contains nothing an agent can apply against the framework. The strictness suggestions remain, and applying them is safe: none of them changes how imports resolve.

The cost is that a bundler project whose `moduleResolution` was hand-broken to something other than `"bundler"` — `"node10"`, say — is detected as a bundler only through its framework dependency or config file, and if it has neither, the tool reports Node-mode findings at a project that resolves like a bundler. That detection gap predates this change; the framework signals cover every scaffolded project in practice.

## Verification

`tests/scaffold.test.mjs` — a `create-next-app`-shaped `tsconfig.json` over a `next` dependency must not print any `"compilerOptions.module"`, `"moduleResolution"`, `"target"`, or `"lib"` finding, must still list the strictness options, and must keep the framework file untouched. The negative control, a Node project with the same options, still reports `moduleResolution` as not set — so a fix that silenced the module findings everywhere fails there.

## Related

Partially supersedes [A bundler project keeps its module settings](../architecture/2026-09-17-a-bundler-project-keeps-its-module-settings.md), which detected the bundler and named the framework's authority but deliberately kept the module conflicts in the report. Its rejected alternative is the decision here; everything else it decided stands. The detection mechanism is that record's and is unchanged.
