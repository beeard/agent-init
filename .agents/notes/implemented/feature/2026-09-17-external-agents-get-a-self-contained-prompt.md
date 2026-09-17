# Decision Record: External agents get a self-contained prompt

Status: implemented

## Problem

The package ships one procedure for running it: `skills/agent-init-setup/SKILL.md`. Its first step is a lookup for a tool that is already on the machine.

```sh
command -v agent-init || ls ./*/src/cli.mjs 2>/dev/null
```

That works for an agent whose machine has the clone or the link. An agent handed this repository's name on a machine that has neither has nothing to go on: the package is not on npm (`npm view agent-init` answers 404), the GitHub remote is private, and the procedure names no location to fetch from. The knowledge it lacks is not the flag list — it is which flag a given repository needs. `--lenient` on a repository with history, `--with-architecture` only for a system genuinely composed from plugins, `--force` never: the same exception handling the skill was written to carry, absent precisely where it is most needed.

The gap was found by writing the prompt a person would have to send by hand, and discovering that no honest version of it could point at the tool.

## Decision

`docs/prompt-for-external-agents.md` holds a copy-paste prompt for an agent in a repository it has never seen, with no clone and no skill.

It ships the tool as a tarball, not a clone. `npm pack` output is self-contained — 68 files, 86 kB, no install step, no `node_modules`, templates resolved relative to the packed `src/cli.mjs` — and it can be verified here from scratch, which a private URL cannot. The prompt tells the agent to extract it to a temporary directory, run `--help` to confirm it has what the prompt describes, and stop rather than adapt if the output disagrees.

The prompt closes four gaps, in the order an agent meets them: where the tool comes from; which flags this repository needs, from the manifest, the language files, and the commit count; the two traps that make a successful run look like more than it is (a hook reporting `not activated` because `core.hooksPath` is set globally, and a `--lenient` run whose advisory findings are the repository's real backlog); and the reporting contract — quote the gate output, name a toolchain that was missing, never report a clean run that did not happen.

It is a third copy of procedure this repository already states twice, in the packaged skill and the README. That cost is stated in the document rather than left to be discovered, and the packaged skill remains the source of truth: step 7 of the prompt links it, so the machine it runs on stops needing the prompt.

## Why an external prompt is not the skill

The skill's job is to run the tool on a machine that has it; this document's job is to get the tool onto a machine that does not. Merging them would put a download step and a version-pinned filename into the skill every user follows, and would make the skill's first instruction "obtain this tool" for readers who already have it. The skill cannot be delivered by the scaffold either — it describes the run — so neither artifact can be the other's delivery mechanism.

## Alternatives considered

**Publish the package to npm and let the prompt say `npx agent-init`.** The obvious fix, and the one that would delete most of the prompt. Rejected for now because it changes the project's release surface, needs an account and a versioning commitment, and the tool is not at a version anyone should install blindly — the tarball is a strictly smaller promise, and a prompt that works with a tarball keeps working after a publish.

**Make the GitHub repository public and clone it.** Would also give the agent the decision records and the test suite. Rejected because the repository is not public today, nothing in the prompt can change that, and the packed tree is what the tool needs at runtime — the rest is history an outside agent has no use for.

**Tell the user to link the skill and let the agent read it.** The durable path, and it is step 7 of the prompt as an optional follow-up. Rejected as the primary delivery because it assumes exactly the machine-local setup an outside agent lacks, and because a symlink into `~/.claude` is a change to someone else's home directory that a prompt should not make silently.

**Paste the procedure inline in the prompt instead of pointing at the tarball's skill.** Would remove the extract-and-verify step. Rejected because the procedure alone does not run anything: the agent still needs the tool, and a prompt carrying both the procedure and the archive is longer than one that carries the archive and a short procedure.

**Gate the new document against the shipped budgets.** Tempting, since everything under `templates/` is gated and this file is not. Rejected because `doc-budgets.manifest.json` budgets documents a receiving repository gets, and this one is never scaffolded — adding it would put a budget on a file the artifact does not contain, which is the category error the budget manifest exists to avoid. It is covered by the package's own `markdownGlobs` prose gates, like the README and the skill.

## Consequences

An agent with no relationship to this repository can set one up correctly, and the failure modes that made the procedure worth writing down travel with it.

The cost is the third copy. The skill and the README already had to stay in step with the CLI, nothing checks that, and this adds a fourth surface for the same facts. The prompt is written to be short for that reason: it names the flags a run needs rather than restating the reference.

A second cost is the pinned filename. `agent-init-0.1.0.tgz` is what the prompt tells the agent to look for, so a version bump invalidates the prompt unless the filename moves with it. That was chosen over a glob on purpose — an agent that cannot find the exact name it was told to look for stops and asks, which is easier to diagnose than a silent fallback to a stale archive.

## Related

What the package writes, and why the skill is not part of it, is in [The package ships its own setup skill](../feature/2026-09-16-the-package-ships-its-own-setup-skill.md). The gates that cover the new document's prose are the ones [gates ship with the rules](../architecture/2026-09-15-gates-ship-with-the-rules.md) describes.
