# Decision Record: A bundler project keeps its module settings

Status: implemented

## Problem

Run against a Next.js application, the tool reported the framework's own configuration as a set of gaps to close:

```text
note: tsconfig.json: "compilerOptions.module" is "esnext", recommended "NodeNext".
note: tsconfig.json: "compilerOptions.moduleResolution" is "bundler", recommended "NodeNext".
note: tsconfig.json: "compilerOptions.target" is "ES2017", recommended "ES2022".
note: package.json "type" is unset; the TypeScript orders assume ESM. Set "type": "module" ...
```

Every one of those is wrong for the project. `NodeNext` requires a `.js` extension on every relative import; `bundler` is what lets the extensionless imports a Next.js or Vite project writes resolve. Following the recommendation stops the application building. `"type": "module"` is the same mistake in the other file, and the closing line — *ask the user whether to apply the options above* — presented all of it as one decision.

The cause is that the TypeScript layer describes exactly one kind of project: a program Node runs directly, with `module: "NodeNext"`, ESM imports and `.js` extensions, which is what the template and its standing orders state. `module` and `moduleResolution` are on `TYPESCRIPT_REQUIRED`, so the report did not merely suggest `NodeNext`; it treated the framework's value as a missing requirement. The tool has no bundler profile and this change does not add one — it stops the Node recommendations reaching a project that is not Node.

An agent working through this correctly rejected the recommendations and asked. That is what the skill says to do, and it is a mitigation rather than a fix: every Next.js, Vite, Astro, or SvelteKit user meets the same harmful advice, and only the reader's judgement stands between it and the file.

## Decision

**The report detects a bundler and says so.** `bundlerBuild` in `src/plan.mjs` answers true when the existing `compilerOptions.moduleResolution` is `bundler`, or when a framework dependency or config file names one: a `next`, `vite`, `nuxt`, `astro`, `@sveltejs/kit`, `parcel`, `webpack`, or `esbuild` dependency, or `next.config.*`, `vite.config.*`, `astro.config.mjs`, `svelte.config.js` at the root.

**The bundler note names the framework's authority, not the tool's preference:**

> a bundler builds this project, so the module settings above are the framework's to choose. "NodeNext" and "type": "module" describe a Node program; apply the strictness options if they help, and leave the module and target values alone.

**The closing line changes with it.** For a bundler project it says to leave the module settings to the framework instead of asking whether to apply everything above. A summary that leaves the reader to work out which half is safe is the defect this record is about.

**The `"type": "module"` note is suppressed for a bundler project.** The bundler resolves the imports itself, so the value is not a gap there. For a Node project the note stands.

**The strictness options are still reported.** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and the rest are not about the module system, and a framework project can adopt them. The note tells the reader to take those and leave the rest.

**Nothing is written.** The file is read, reported on, and left exactly as it is, which is unchanged behaviour.

## Alternatives considered

**Move `module` and `moduleResolution` off `TYPESCRIPT_REQUIRED` for every project.** The smaller change, and it removes the word "requirement" from a value the tool cannot know. Rejected because it makes the report vaguer for the project the layer was written for: in a Node program those two options are the ones that decide whether the imports resolve at runtime, and demoting them everywhere to fix one case trades a real signal for a smaller diff.

**Add a `bundler` or `web` stack profile with its own template and gates.** The complete answer, and what a repository that maintains a Next.js app would want. Rejected for now because it is a product extension rather than a correction: a profile needs its own tsconfig, testing guide, standing orders, and at least one gate, and the request here is that the tool stop giving harmful advice, which does not need any of that.

**Detect only `moduleResolution: "bundler"`.** The exact declaration TypeScript added for this case, and unambiguous. Rejected as the only signal because a project that has not written it yet still has a framework, and the dependency and config checks cost one `existsSync` each. The two are ordered so the explicit declaration is checked first.

**Silence the module conflicts entirely for a bundler project.** Would leave the cleanest output. Rejected because the report is a report: a reader comparing their config to the template is entitled to see the difference, and suppressing rows would hide the strictness options along with the module ones.

**Have the skill carry the guidance instead of the tool.** The skill already tells an agent to ask before editing, and adding framework exceptions to it would be prose with no check behind it. Rejected because the tool knows which project it is looking at and the skill does not; the report is printed by the run that read the config.

## Consequences

A Next.js, Vite, Astro, or SvelteKit repository is now told that its module settings belong to the framework, and the two recommendations that would break it are named as such rather than recommended.

A Node project's report is unchanged, which the negative control pins: without a bundler the same options are still reported as unset and the ESM note still appears, so a fix that silenced them everywhere fails the suite.

The tool still has one TypeScript profile. A bundler project gets its own configuration left alone and the strictness advice, but no testing guide, standing orders, or gate of its own — that remains the profile this record declined to build.

## Related

**Partially superseded by** [A bundler project gets no module findings](../bug-fix/2026-09-17-a-bundler-project-gets-no-module-findings.md): the "Silence the module conflicts entirely" alternative rejected below shipped after a bundler project's agent applied the reported findings and broke the build. The detection, the note, the closing line, the `"type"` suppression, and the strictness reporting decided here stand; the choice to keep the module conflicts visible does not. The quoted note's wording also changed with that fix, since "the settings above" no longer exist.

Which options the layer assumes and why is in [TypeScript projects are initialised, not just annotated](../feature/2026-09-17-typescript-projects-are-initialised.md). The procedure an agent follows when a config is left alone, including the framework ordering, is in [The installed skill names its own package](../bug-fix/2026-09-17-the-installed-skill-names-its-own-package.md).
