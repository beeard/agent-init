# Decision Record: A release follows a procedure that publish enforces

Status: implemented

## Problem

Three versions had been published and none of them followed a written procedure. The steps lived in Git history and in one decision record: a `chore: <version>` commit touching only `package.json`, a `v<version>` tag, and a manual round trip from the registry described in [The package is ready to publish](../feature/2026-09-17-the-package-is-ready-to-publish.md). An agent asked to prepare a publish found none of this on its own. It bumped the version and ran the checks, but did not commit, tag, or name the post-publish verification until asked why there was no procedure.

The same pass surfaced two defects a procedure would have caught. `docs/prompt-for-external-agents.md` pinned the tarball as `agent-init-0.1.2.tgz`, while `npm pack` has named it `beeard-agent-init-<version>.tgz` since the package moved under the scope. And `npm login` with the npm shipped by the distribution fails with `ENYI: Web login not supported`, which cost a round trip to diagnose.

Nothing stopped a publish from a dirty tree, an untagged commit, or a failing check. The standing order that a rule in prose needs a gate applied here as much as anywhere.

## Decision

**The procedure is a skill, `.agents/skills/agent-init-release/SKILL.md`**, linked at `.claude/skills/agent-init-release` so Claude Code registers it. It covers confirming the base, choosing the version against the registry, bumping it with every pinned reference, the three checks and a pack dry run, the `chore: <version>` commit and tag, the publish the user runs with current npm, and the registry round trip with an empty cache and home.

**`npm publish` enforces the parts a script can check.** `prepublishOnly` runs `scripts/prepublish.mjs`, which refuses when `package.json` or any path in `files` has an uncommitted or untracked change, when `HEAD` is not tagged `v<version>`, or when `npm test`, `npm run check`, or `npm run format:check` fails. It runs for whoever publishes, from any shell. Changes outside the shipped paths do not block, because they are not in the tarball.

**The skill is this repository's alone.** It is outside `files`, so the tarball does not carry it, and outside `templates/`, so no scaffold writes it. `tests/release.test.mjs` asserts both: one test reads the `npm pack --dry-run` listing, and one scaffolds with every skill and looks for the name. The same file breaks the release gate once per refusal and asserts it.

**The package gates read the skill.** `scripts/gates/config.json` adds `.agents/skills/**/*.md` to the Markdown and link corpora, so the skill is held to the same wrap and link rules as the rest of the package's prose.

`AGENTS.md` names the skill in a `## Releasing` section.

## Alternatives considered

**A `RELEASING.md` or a section in `AGENTS.md` holding the whole procedure.** Readable by any agent or person. Rejected because the procedure is only needed when releasing, and `AGENTS.md` is read on every task under a word budget; a skill loads when the task matches and the standing orders carry one pointer to it.

**Put the skill under `skills/`, beside the setup skill.** One skills directory in the repository. Rejected because `skills/` is in `files`: the release skill would ship in every tarball and `--install-skill` would sit one directory away from copying it into users' homes.

**Publish from CI on a tag.** Removes the local login and the npm version problem. Rejected for now because it needs an npm token stored as a repository secret and a decision about provenance, and the user asked for the procedure, not a change to who publishes. The gate holds either way: a CI publish runs `prepublishOnly` too.

**Check only the tag, not the working tree.** Simpler. Rejected because a tagged `HEAD` with an edited `src/` publishes code no commit holds, which is the case the tag was meant to rule out.

## Consequences

A publish now fails from anything but a committed, tagged, passing tree, and the failure names what is missing. The cost is that a deliberate publish from an unusual state has to go through `--ignore-scripts`, which is visible in the command rather than silent.

`prepublishOnly` runs the full test suite and the dogfood check, so a publish takes as long as both, and the Go, Rust, and TypeScript tests skip on a machine without those toolchains exactly as they do in `npm test`. CI remains the place those run.

The registry round trip is still manual. It needs the published package, so it cannot run before publishing, and the skill makes it a named step rather than a memory.
