# Prompt for an agent that does not have this repository

A copy-paste prompt that makes an arbitrary agent able to run `agent-init` in a repository it has never seen, on a machine where this clone, the `agent-init-setup` skill, and any knowledge of the tool are absent.

The text in the fenced block is the deliverable. Everything around it explains why it is shaped that way, so the next person can change it deliberately.

## What an outside agent is missing

The packaged skill (`skills/agent-init-setup/SKILL.md`) was written for an agent that already has the tool. It is the procedure, and it stays the source of truth for the procedure:

```sh
command -v agent-init || ls ./*/src/cli.mjs 2>/dev/null
```

That lookup succeeds on the author's machine and nowhere else. A receiving agent has four separate gaps, and a prompt that closes fewer than four fails:

| Gap | Why it is real |
|---|---|
| **The tool itself** | Not on `PATH`; not on npm (`npm view agent-init` → 404); the GitHub repository is private. There is no canonical download location, so the prompt must supply one. |
| **The decision rules** | Which `--stack`, `--lenient` or not, `--with-architecture` or not. The knowledge is nearly all exception handling, and the flag that loses data (`--force`) is one of them. |
| **The operational traps** | `core.hooksPath` set globally leaves the installed hook reporting `not activated`, so the gates never run on commit; a strict run on an existing repository greets the user with a wall of findings. |
| **The reporting contract** | An agent that reports "done" over a gate run it never performed is the failure this tool exists to prevent, reproduced by the agent using it. |

## Why it is delivered as a tarball

`npm pack` output is the only self-contained form accessible here, and the experiment confirms it is enough: the packed tree is 68 files, 86 kB, and the extracted `src/cli.mjs` scaffolds correctly with no install step and no `node_modules`, because the package has zero runtime dependencies and resolves its templates relative to its own file location.

A clone cannot be prescribed, because there is nothing public to clone. The tarball is also the smallest thing to hand over, and it carries the packaged skill with it, so the agent can install the durable version of the procedure afterwards instead of relying on this prompt for every future run.

## The prompt

```text
Set up the agent-operating structure in this repository using a tool called agent-init. It writes standing orders (AGENTS.md), a decision-record tree (.agents/), four skills, a documentation standard (docs/), and the gates that enforce them (scripts/gates/), plus a pre-commit hook. Everything it writes is owned by this repository afterwards — nothing it writes refers back to the tool.

You have no prior knowledge of this tool. Do not improvise a substitute: a hand-written AGENTS.md is exactly what this replaces, and rules without the checks that enforce them are the failure mode it exists to fix.

## 1. Find the tool

The tool is attached as a tarball, agent-init-0.1.0.tgz, in the same place attachments are delivered to you, or at a path the user gives you. It is not on npm and there is no public repository to clone; if you cannot find the tarball, stop and ask the user for the path rather than looking for it online.

    mkdir -p /tmp/agent-init && tar -xzf <path-to>/agent-init-0.1.0.tgz -C /tmp/agent-init
    node /tmp/agent-init/package/src/cli.mjs --help

Requirements: Node 20 or newer, Git, and a shell. The tool has zero runtime dependencies and needs no install step — the packed tree carries its own templates. Confirm the --help output lists the options named below before going further; if it does not, the tarball is not what this prompt expects, so say so instead of adapting.

## 2. Read the repository before choosing any flag

All three checks are cheap, and each one decides a flag:

    head -20 .agents/manifest.json 2>/dev/null   # already set up?
    git rev-list --count HEAD 2>/dev/null || echo 0   # fresh, or existing?
    ls go.mod pyproject.toml setup.py setup.cfg requirements.txt Cargo.toml tsconfig.json package.json 2>/dev/null

A .agents/manifest.json means this repository already adopted the structure. Do not run the tool again as if it were new. Say what the manifest records, and ask whether the remaining work is adding a layer (--stack <name> or --with-architecture) rather than a fresh setup. Do not use the agent-init:begin markers in AGENTS.md as this check: they only exist once a stack or architecture layer has contributed a section, so a repository set up with base alone has none.

Languages, from what the repository actually maintains:

    go.mod                                            -> --stack go
    pyproject.toml, setup.py, setup.cfg, requirements.txt, or *.py in the root -> --stack python
    Cargo.toml                                        -> --stack rust
    tsconfig.json, or package.json listing typescript -> --stack typescript

Take each language the repository owns, not every file type you can see: an examples/ tree in another language is not a language this repository maintains, and every stack adds a gate that needs that language's toolchain — a stack that cannot run is a gate that fails. There is no javascript stack; a plain JS project correctly gets base alone. Repeat --stack for more than one.

Fresh or existing:

- No commits yet (git rev-list --count HEAD is 0 or fails): run without --lenient. The gates are strict from day one and a fresh tree passes them.
- Any history or content: add --lenient. Every gate becomes advisory, so the first run reports the backlog instead of failing on rules the team never agreed to.

If this directory is not a Git worktree the tool refuses to run. Run git init first — that is almost always what the user wants. --allow-non-git is for genuine exceptions only: without Git the repository loses change-scope and the staged-only bounds on the commit gates.

## 3. Ask before the two flags that can be wrong

--with-architecture adds a composition discipline (plugins, capability seams, reversible registrations). Use it only when the system really is assembled from plugins or extension points. A map of an architecture the repository does not have is worse than no map, so ask when in doubt rather than guessing.

--name "<Project Name>" defaults to the directory name. Use the real project name, with capitals and spaces; the tool derives the slug itself.

## 4. Run it

    node /tmp/agent-init/package/src/cli.mjs . --name "<Project Name>" --stack <a> [--stack <b>] [--lenient]

--dry-run writes nothing. Use it when the user is unsure and show them the plan.

--stack typescript initialises the toolchain as well as the rules:

- No tsconfig.json: the tool writes one plus a package.json carrying typecheck, the gate scripts, and typescript in devDependencies. Tell the user to run npm install, because the compiler the gate resolves is their dependency, not the tool's.
- An existing tsconfig.json: it is left untouched and the run prints every option the TypeScript orders assume but the file does not set. When that report appears, say which options are missing and why they matter, and edit the file only on a yes. Edit in place so comments survive — never round-trip it through a JSON writer, and never narrow strict or include to make a finding go away.

## 5. Verify, then report the actual result

    node scripts/gates/run.mjs

Read the output. Green means the structure is internally consistent. With --lenient the findings are advisory and the run exits 0 — read them to the user anyway, because they are this repository's real backlog, and say that tightening a gate means removing "advisory": true from that gate's entry in scripts/gates/gates.json.

Then read what the run reported about the pre-commit hook:

- activated — the hook runs the commit gates. Nothing to do.
- not activated — Git's core.hooksPath already points at another hooks directory, so the tool left it alone rather than taking it over. Check whether that directory has a pre-commit chaining to this repository's own hook. If it does, the gates run anyway. If it does not, they run only when invoked by hand — report that as a finding, not as a success.

Do not "fix" that by pointing core.hooksPath at .githooks on your own initiative: Git has one hooksPath, and repointing it silently disables whatever the other directory was providing. Say what would be lost and let the user choose.

## 6. Constraints

- Never pass --force. It overwrites files the user has edited. Re-running without it keeps existing files, so a re-run is safe but useless — if an update is needed, ask first.
- Do not rewrite AGENTS.md. It is deliberately generic, and the tool has already added what fits the languages and the architecture. The user makes it theirs.
- Do not commit or push. Say the tree is ready and let the user decide whether it goes in as one commit.
- Report only what you observed. Quote the gate output. If a gate did not run, or a toolchain was missing, say that plainly instead of reporting a clean run — a report that does not mean what it says is worse than a failure.

## 7. Afterwards, optionally

The tarball also contains the tool's own setup skill, which is this procedure in its versioned form. Linking it makes future runs on this machine work without this prompt:

    mkdir -p ~/.claude/skills
    ln -s /tmp/agent-init/package/skills/agent-init-setup ~/.claude/skills/agent-init-setup

Ask before doing it: it writes outside the repository.
```

## How to produce the tarball

From this clone:

```sh
npm pack --pack-destination /tmp            # → /tmp/agent-init-0.1.0.tgz
```

The version in `package.json` is what names the file, so the name in the prompt has to move with a version bump. Worth pinning deliberately: an agent that cannot find the exact filename it was told to look for should stop and ask, and that failure is easier to diagnose than a silent fallback to a stale copy.

## Why each part is in the prompt

| Part | Without it |
|---|---|
| "No prior knowledge; do not improvise" | The agent writes an `AGENTS.md` and calls it done. This has to be the first paragraph, because it is the failure that preempts the others. |
| Where the tool comes from | The agent tries `npx`, then `git clone`, then asks the user three times. |
| `--help` before anything else | An agent with a stale or wrong archive scaffolds from a tool it has not identified. |
| The manifest check before the flags | A re-run on an adopted repository keeps every existing file, reports success, and changes nothing. |
| The language table and the `examples/` caveat | Every visible file extension becomes a stack, and each one adds a gate needing a toolchain the repository does not have. |
| `--lenient` by commit count | A strict run on a real repository produces a wall of findings about rules nobody agreed to, and the reasonable response is to delete the tool. |
| Asking on `--with-architecture` | A confidently empty architecture map, which the design doc calls worse than no map. |
| Asking before editing `tsconfig.json` | A config round-tripped through a JSON writer, with the comments gone. |
| Reporting `not activated` as a finding | A repository whose gates never run on commit, reported as fully set up. |
| "Never `--force`" | The one flag that destroys the user's edits, named so it is not reached for during the first failure. |
| "Report only what you observed" | The tool's own thesis — a rule no check verifies is a suggestion — inverted by the agent that ships it. |

## What this prompt deliberately does not do

- **It does not restate the whole README.** `--skills`, the layer model, and the gate inventory are not needed to run the tool correctly, and a longer prompt is a prompt an agent skims.
- **It does not install anything on the target machine.** No global link, no `PATH` entry; the tarball is extracted to a temporary directory and run from there. The skill link in step 7 is the one durable change, and it is offered and asked about rather than done.
- **It does not try to keep the procedure and the packaged skill in step.** That is already the known cost recorded in [the setup-skill decision record](../.agents/notes/implemented/feature/2026-09-16-the-package-ships-its-own-setup-skill.md); this document adds a third copy for the one case the skill cannot cover, and says so instead of pretending otherwise.
