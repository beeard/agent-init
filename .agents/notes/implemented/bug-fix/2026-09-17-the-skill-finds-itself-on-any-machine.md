# Decision Record: The skill finds itself on any machine

Status: implemented

## Problem

The setup skill assumed one machine shape in four places. The coordinate lookup read only `~/.claude/skills/agent-init-setup.json` and the repository-local copy, so a skill installed into any other agent's skills directory — another harness's, or Claude's when `CLAUDE_CONFIG_DIR` relocates it — could never find its own coordinate and always fell through to asking the user. The stack detection ran `fd`, which is not installed on every machine, leaving an agent without it to improvise. The procedure opened with repository checks and first mentioned the empty-directory ordering buried in the TypeScript section, so an agent invoked on a bare directory ran the tool into a refusal. And `userSkillsDir` in `src/skill-install.mjs`, the link target in `scripts/install-local.mjs`, and the CLI help all hard-coded `~/.claude/skills`.

The session that surfaced this invoked the skill directly, without arguments, in an empty directory, and hit the refusal first and the framework-ordering problem second. A skill whose first moves depend on the reader's machine layout is a procedure for one machine, not a procedure.

## Decision

**The skill locates itself.** The coordinate file is written beside the installed `SKILL.md`, so the directory the agent loaded the skill from is itself the first place to look — whatever harness, whatever skills layout. The procedure now says to check that directory before running any shell, with the known paths (including `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills`) as the shell fallback.

**The installers follow `CLAUDE_CONFIG_DIR`.** `userSkillsDir` and `install-local.mjs` derive the skills directory from the variable when it is set, so the skill is installed where a relocated session reads. `--skill-dir` still overrides both, and the default without the variable is unchanged.

**Stack detection uses plain `ls`.** `ls -1 <candidates>` over the known manifest names, plus `ls -1 *.py` for the Python fallback, runs on any POSIX machine. The skill names the choice so a reader does not "upgrade" it back to `fd`.

**The ordering decision comes first.** The branch section now opens the run procedure: empty directory → framework first, then `git init`, then the tool; repository with content → `--lenient`; fresh repository → strict; not Git → `git init` or `--allow-non-git`. The TypeScript section points at that rule instead of restating it, so the two cannot drift apart.

## Alternatives considered

**Enumerate every harness's skills directory in the skill.** `~/.codex/skills`, `~/.config/opencode/...`, and the rest. Rejected because the list is unbounded, ages with every harness release, and is unnecessary: the agent holding the skill already knows where it read the skill from, which is the one path that is correct by construction. The fallback list covers the cases where it does not.

**Move the coordinate file inside the skill directory.** Would make `ls` of the skill's own directory the whole lookup. Rejected because the file is deliberately written beside the skill, not inside the package it names — that decision and its reason live in [The installed skill names its own package](2026-09-17-the-installed-skill-names-its-own-package.md), and this change reuses the placement rather than revisiting it.

**Keep `fd` and add an `ls` fallback.** Preserves the faster tool where it exists. Rejected because a skill with two detection paths is two procedures to keep consistent, and the directory listing being replaced is a handful of fixed names — `fd`'s speed is worth nothing here.

## Consequences

A skill installed anywhere can name the specifier that installed it, an agent on a machine without `fd` follows the procedure exactly, and an agent invoked in an empty directory reads the ordering before it reads the run command. The installers honour the same relocation the tool they install into does.

The cost is that the shell fallback in the skill is still a list of known paths: an agent that cannot see its own skill directory and finds no coordinate in the fallbacks asks the user, exactly as before. Nothing regressed; the self-locating step only shortens how often that path runs.

## Verification

`tests/install-skill.test.mjs` — `CLAUDE_CONFIG_DIR` moves both the skill copy and the coordinate file, and no `~/.claude` is created behind the relocated config. `tests/install-local.test.mjs` — the same variable moves the machine-local link and the default location stays empty. The skill's text is procedure, not code, and is exercised by the runs agents make with it.
