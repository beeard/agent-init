# Decision Record: The package ships its own setup skill

Status: implemented

## Problem

The tool ships four skills into every repository it scaffolds, and none of them can help run the tool: they arrive after the fact. An agent asked to set up a project had nothing to follow. The procedure existed only as prose in the README, which is written for a person reading a page rather than for an agent executing steps — it does not say how to find the tool, how to tell a fresh repository from an adopted one, or which `--stack` a repository needs.

That gap is not academic. The knowledge it takes to run this tool correctly is almost entirely exception handling: `--lenient` for a repository that already has content, `--with-architecture` only for a system that really is composed from plugins, `--force` never. An agent without it will improvise, and the improvisation differs per session.

A skill written privately for one machine closed the gap for its author and left two problems. It hard-coded an absolute path to the clone, so it broke the moment the clone moved, and it existed in exactly one place that no test and no gate could see.

## Decision

The package ships `skills/agent-init-setup/SKILL.md`, and a user links it where their agent looks for skills:

```sh
ln -s /path/to/agent-init/skills/agent-init-setup ~/.claude/skills/agent-init-setup
```

It lives at the package root rather than under `templates/` because it cannot be part of the scaffold: a skill that sets a repository up must exist before that repository has any skills, and everything under `templates/` is delivered by the run it would be describing.

**The skill is path-agnostic.** It resolves the tool with `command -v agent-init` and falls back to looking for a clone, rather than naming one machine's directory. That is what makes it shippable at all.

**The package's own gates read it.** `markdownGlobs` and `linkGlobs` gained `skills/**/*.md`, so the skill's prose is checked for wrapping, links, and its final newline like everything else the package writes. A test asserts the general rule: every Markdown file in the package is either selected by the configured globs or deliberately excluded by `skipGlobs` or by being a symlink to a file that is.

## Alternatives considered

**Put the skill under `templates/base/.agents/skills/` so it ships into every repository.** The obvious place, and it needs no install step. Rejected because it cannot work: the skill would arrive with the scaffold, and its whole job is to run the scaffold. The receiving repository would get a skill whose first instruction is a step already completed.

**Ship it under `templates/` but exclude it from the plan.** Would put it in the package without delivering it. Rejected because `templates/` means "applied by the plan" everywhere in this codebase, and a file there that the plan skips is a second meaning for one directory — the kind of implicit rule this project writes gates to avoid.

**Keep it private and hard-code the path.** What existed before. Rejected because it served one machine and one clone location, could not be shared, and was invisible to every check in this repository. The version in the package is strictly better for its author as well: it is the same skill with the hard-coded path removed.

**Let the skill name the path through a placeholder the installer substitutes.** Would let the installed copy name the clone explicitly instead of searching. Rejected as a mechanism with no other consumer: it needs an install step that does substitution, which is more moving parts than `command -v`, and the fallback search still has to exist for anyone who reads the file directly.

**Add `skills/**/*.md` to the globs and stop there, without the test.** The configuration change is what makes the skill covered today. Rejected because it makes the coverage a fact someone remembered rather than a property that holds: the next directory of shipped prose would be invisible again, exactly as `skills/` was until a gate happened to fail on it.

## Consequences

An agent can set a project up correctly in any repository on any machine, and the knowledge is versioned with the tool that owns it rather than living in one person's home directory.

The cost is a new kind of artifact in the package, and one that is not delivered by the run it describes. Whoever maintains this tool now has two things to keep in step with the CLI: the README, for people, and the skill, for agents. They cover the same flags, so a new flag has to reach both. Nothing checks that, and nothing can — the skill is prose, and a test can only assert that it is gated, not that it is current.

A second cost is the install step. Everything else in this package is reached by cloning and running it; the skill needs a symlink into a directory outside the repository, and a user who skips that step gets no help and no error. The README says so, which is the only enforcement there is.

A third cost is the coverage guard's two exceptions. `skipGlobs` is a deliberate exclusion and a symlink is the same file as its target, so both are legitimately absent from the corpus — but the guard has to name them, and a future reason to exclude a shipped document would need adding there rather than in the configuration. The guard is deliberately the stricter of the two: it fails when a file is covered by nothing, which is the state that stayed silent for as long as it did.

## Related

What the package writes into a repository is in [Ship the gates with the rules](../architecture/2026-09-15-gates-ship-with-the-rules.md). Where a gate takes its corpus from, and why a declaration may only widen it, is in [A gate's corpus comes from the configuration](../architecture/2026-09-16-a-gates-corpus-comes-from-the-configuration.md).
