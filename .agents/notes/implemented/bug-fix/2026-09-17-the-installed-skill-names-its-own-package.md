# Decision Record: The installed skill names its own package

Status: implemented

## Problem

The setup skill was installed from the published package onto a machine with no clone. An agent following it got as far as finding the tool and then stopped:

> Skillen sier eksplisitt at verktøyet «is not published under a name anyone should install blind» og at det skal kjøres «at the version this skill came with». Men skillen inneholder ingen versjon og ingen pakkenavn — kun filen SKILL.md, ingen manifest eller lockfile.

That is a defect in the skill, not in the agent. It refused to guess a package name, which is the correct call — `npx <guess>` fetches and executes whatever that name resolves to, so guessing at an unpublished name is a typosquat vector rather than a lookup. The skill put an agent in the position of needing that judgment and gave it nothing to judge with.

The gap was structural. The skill was written for two situations, a clone and a linked command, and both of them can find the tool locally. A skill installed from a registry cannot: the package name and the version it came with are facts only the installer knows, and nothing recorded them. The prose said "at the version this skill came with" while the artifact carried no version at all.

## Decision

**`--install-skill` writes the coordinate it installed from**, as `<skills-dir>/agent-init-setup.json`:

```json
{
  "npx": "@beeard/agent-init@0.1.0",
  "version": "0.1.0"
}
```

One field is the answer: the exact `npx` specifier, package and version together. `version` is there because an agent may need to say which version set a repository up.

**The file sits beside the skill directory, not inside the package it names.** A `--link` install would otherwise write into a clone, which is not the link's to change and may be read-only.

**It is written only when its content differs**, so a second install reports `ok` rather than a change that did not happen. It is written after the skill is in place: a coordinate pointing at a skill that is not there is the same false *installed* this file exists to prevent.

**The skill reads it first, in both locations**, then falls back to the two local checks:

```sh
for f in ~/.claude/skills/agent-init-setup.json .claude/skills/agent-init-setup.json; do
  if [ -f "$f" ]; then cat "$f"; break; fi
done
command -v agent-init || ls ./*/src/cli.mjs 2>/dev/null
```

**With nothing found, the skill says to ask**, and says why a guess is wrong. That is what the agent did on its own; the skill now states it, so the next agent does not have to derive it.

**The skill also states the framework ordering.** `create-next-app` and `cargo new` write their own configuration, so a run on an empty directory would have the generator replace what the tool wrote. Scaffold first, then run the tool: it finds the configuration, leaves it alone, and reports what it does not set. The agent raised this from the directory name alone and was right to.

## Why the coordinate is written rather than hard-coded

A name and version in the skill's own prose would be wrong the moment either changed, and the failure would be silent — the same class of defect as this one. The value is only correct at install time, so install time is where it is written.

The lookup is also what makes the fallback honest. A clone install has no coordinate file, because `install-local.mjs` links rather than copies and a link into a clone is already findable through `command -v` or the sibling-directory check. The skill therefore lists the coordinate first and the local checks second, and neither path is dead.

## Testing

Two tests in `tests/install-skill.test.mjs`. One reads the written file back and compares it to `package.json`, so the recorded specifier cannot drift from the published name and version — the defect would have been caught by exactly that assertion. The other installs with `--link` and asserts the file lands beside the link and *not* inside the package, which is the mistake that would make a read-only checkout fail.

The lookup itself was run in three states: a coordinate in the home directory from an empty project directory, a project-local coordinate with an empty home, and nothing installed at all. The first two print the coordinate and exit 0; the third prints nothing and exits 0. `[ -f x ] && cat x && break` was the first form and exits non-zero when the last candidate is missing, which reads as a failure to an agent that checks exit codes — the form in the skill is the one that was run.

## Alternatives considered

**Hard-code the package name and version in the skill's prose.** No extra file, and the agent would read the answer in the step it is already on. Rejected because both values change, and a stale one fails silently — the skill would name a version that no longer exists, which is the same defect one release later. The value is only correct at install time.

**Ship a `package.json` inside the skill directory.** The npm-native way to state a package's own name and version. Rejected because a stray manifest turns the directory into a package boundary for any tool that walks up from it, and because it would state the *skill's* package rather than the tool the skill has to run.

**Put the whole specifier in a file named for the tool, `agent-init.json`.** Shorter, and it drops the repetition of `agent-init-setup`. Rejected because the file is a property of the skill installation — which skill, from which package — and naming it after the tool invites a second tool's skill to collide with it.

**Have the skill derive the name from the directory it was installed into.** No file at all. Rejected because the directory name is `agent-init-setup`, a skill, and the package is `@beeard/agent-init`, a package: the mapping is a coincidence of naming rather than a fact the skill can rely on.

**Make the missing coordinate an error rather than a fallback.** The agent did stop and ask, which worked. Rejected as the design because it is right only for the installed case: a clone install has no coordinate file by construction and must not be reported as broken.

**Have `--install-skill` also install the CLI globally**, so the skill can name a command instead of a specifier. Rejected because it widens what one flag does to the machine for no gain: the coordinate is already enough for `npx`, and a global install is the user's decision about their own `PATH`.

## Consequences

An agent with the published skill can now run the tool without asking, and the answer it finds names the exact version, so an unpinned upgrade mid-run is not a possibility it has to avoid by judgment.

The cost is one more file in the skills directory, and a name — `agent-init-setup.json` — that the CLI and the skill prose both state. Neither is checked against the other; a rename would have to reach both.

`0.1.0` does not carry this fix. The published skill is the blind one, so a user who installed from it hits the same wall until a new version is published and installed.

## Related

Why the skill is installed outside any repository is in [The package ships its own setup skill](../feature/2026-09-16-the-package-ships-its-own-setup-skill.md), and what it delivers when it runs is in [Skills are linked where the agent reads them](../feature/2026-09-17-skills-are-linked-where-the-agent-reads-them.md).
