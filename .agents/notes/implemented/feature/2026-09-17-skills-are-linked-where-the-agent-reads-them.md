# Decision Record: Skills are linked where the agent reads them

Status: implemented

## Problem

Every run wrote its four workflow skills to `.agents/skills/<slug>-<name>/SKILL.md` and stopped there. Claude Code does not read that directory. Its project location is `.claude/skills/<skill-name>/SKILL.md`, so a repository that had just been set up held four skills that its agent could not see, and the standing orders in `AGENTS.md` pointed at them as if it could.

The failure was silent in every direction. The plan reported four skills added, the gates passed, the files were correct — and the only thing that would have used them read a directory that did not exist. Nothing in the tool or its checks compared where a skill is written with where an agent looks for it.

It was found by reading Claude Code's own documentation rather than by a check: the supported locations are the enterprise, personal, project, nested, additional-directory, and plugin ones, and `.agents/skills/` is not among them.

## Decision

`buildPlan` emits one relative directory symlink per selected skill, alongside the `CLAUDE.md` link it already emitted:

```text
.claude/skills/<slug>-<name> -> ../../.agents/skills/<slug>-<name>
```

The canonical copy stays in `.agents/skills/`, which is the agent-neutral location, and the link exposes it where the agent reads.

**The link keeps the `<slug>-` prefix, because the registered name is the directory name.** A skill is registered under the name of the directory the agent finds it in, so a link at `.claude/skills/agent-notes` registers `agent-notes` whatever the file's own `name:` says. A bare name is also the one name that can lose: Claude Code resolves personal skills before project ones, so a project skill called `agent-notes` is shadowed by a personal skill of that name. The prefixed name is what makes the project's own skill the one that runs.

The precedence claim is the documented rule, not something this change measured — testing it would mean writing a `agent-notes` skill into a user's home directory, outside the repository, which the tool does not do on its own initiative. It does not have to hold for the decision to be right: the prefix is also the name every reference already used, so it is the smaller change *and* the conservative one. A bare name buys a shorter invocation and risks a collision; a prefixed name risks only being longer than it needs to be.

**Every reference names the registered skill.** `AGENTS.md` names four skills, `docs/AGENTS.md` a fifth reference, and `code-review` names `prose-standard`, all with the prefix the template already carried. Making the link agree with them, rather than renaming all six, is what keeps the orders pointing at skills that exist.

**Relative, not absolute.** The link resolves against its own directory, so it survives a clone and carries no path from the machine that scaffolded. An absolute link would work once and dangle everywhere the repository is checked out afterwards.

**Claude Code follows it, and loads the skill once.** The documentation states that a `<skill-name>` entry in the project location may be a symlink to a directory elsewhere on disk, that `SKILL.md` is read from the target, and that a skill reached through several locations is loaded once. That last property is what makes the two paths safe to hold at the same time rather than a duplicate.

**A link is created with its parent directory.** `.claude/skills/` may not exist, so `createSymlink` makes the parent of a nested link before creating it. The plan's own paths are the only ones this creates.

**A platform that refuses a directory link reports it skipped.** The `CLAUDE.md` link falls back to writing `@AGENTS.md` when symlinks are unavailable, and a directory link has no equivalent: a file written at that path occupies the skill directory and shadows the skill, and copying the tree would leave two copies to drift. The outcome line names the canonical path instead.

**An existing `.claude/skills/<name>` is kept.** The rule for every path the tool does not own, and it is what the negative control pins.

## Alternatives considered

**Write the skills to `.claude/skills/` and link `.agents/` to them.** Removes the link from the path an agent actually reads, which is the one that matters. Rejected because it reverses the repository's own convention to serve one agent: `.agents/` is where the structure is agent-neutral, and the tool is not only for Claude Code.

**Write both, and keep them identical.** Would work with no link at all. Rejected because it is two copies of four files in every receiving repository, and the second copy is the one that goes stale — the failure `.merge` and `.compose` exist to avoid, applied to a directory that has no merge rule.

**A CLI command to install the links, rather than the scaffolder writing them.** What `install-local.mjs` does for the pieces that live outside a repository. Rejected because a relative link inside the repository is repository content: it is the same kind of artifact as `CLAUDE.md`, and it has to exist in the clone for every clone, not only on the machine that ran an install command.

**A `postinstall` script that links into the user's home directory.** Rejected because it contradicts the boundary already recorded for `agent-init.githooks`: a repository must not be able to make something run, and a package must not write outside its own tree without being asked. It is also the pattern users disable with `--ignore-scripts`.

## Testing

Three tests in `tests/scaffold.test.mjs`, and the first two of them exist because the first version of this change was wrong.

The first version read the rule that a skill is registered under its directory name and concluded the prefix should be dropped at the link, leaving the `name:` in each skill and six references in the standing orders naming a skill that was not registered. The verification that followed — a session listing and invoking the skills in a fresh scaffold — showed the registered name was the bare one, so every reference named something that did not exist. Invoking the prefixed name still resolved, but only through the tool's own name matching, which is not a contract to rely on.

So one test asserts that each skill's declared `name:` equals the directory it is registered under, and another asserts that every skill name the standing orders mention is a directory the run registered. Both fail against the version that shipped the defect, which is what makes them controls rather than descriptions.

The third is the negative control for the link itself: an existing `.claude/skills/<name>` is kept and not replaced.

**The acceptance check is a live session, and it has a counter-test.** A scaffolded repository was driven with real sessions, and the evidence is the tool-call stream rather than a model's account of what it did: the four skills are listed, `Skill(<slug>-agent-notes)` returns `is_error=false` with the skill launched, and the content is read from the `.agents/skills/` target through the link. The counter-test is the half that makes those three mean anything: `Skill(agent-notes)` returns `is_error=true, Unknown skill: agent-notes`, so registration follows the directory name, and after the correction the directory name is the name all six references already used.

## Consequences

A repository set up with agent-init now has skills its agent can load, which is what the standing orders always claimed.

The plan and the report carry four more lines per run, and a dry run shows the links before they are made.

The cost is a second path that has to stay in step with the first, and the defect above is what that costs when it does not: the paths agreed on where the files were and disagreed on what the skill was called. Two tests now compare the name the orders use, the name the skill declares, and the name it is registered under.

Committing the links is safe and is what a team sharing a repository wants. A repository that would rather hold the files themselves — a cloud session that clones without following links, or a platform that refused them — can replace the links with copies; the run's own report names the canonical path when it cannot create one.

Nothing gates `.claude/`. The skills themselves are still judged where they are written, under the corpus that `.agents/skills/**/*.md` already covers, and a link is the same file as its target — a second corpus over it would judge one document twice and report every finding in both places.

## Related

The structure this delivers is in [Ship the gates with the rules](../architecture/2026-09-15-gates-ship-with-the-rules.md), and the machine-local links that stay outside a repository are in [Machine-local pieces are installed by link](../process/2026-09-16-machine-local-pieces-are-installed-by-link.md).
