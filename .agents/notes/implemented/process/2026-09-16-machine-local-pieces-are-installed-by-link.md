# Decision Record: Machine-local pieces are installed by link

Status: implemented

## Problem

Two pieces of this package cannot live in a scaffolded repository and cannot be delivered by a clone either, so both were created by hand on one machine:

- **The hook chain**, at `~/.config/git/hooks/pre-commit`. Git has one `core.hooksPath`, so a global value hides every repository's own `.githooks/` — which is exactly what this package writes. The chain runs the repository's hook when it has one.
- **The setup skill**, at `~/.claude/skills/agent-init-setup`. An agent looks for skills outside any repository, so the versioned file at `skills/agent-init-setup/` is unreachable until something puts it there.

Both worked and neither was reproducible. Moving to another machine meant recreating them from memory or from a transcript, and a copy that drifted from the versioned one would not be noticed by any check.

## Decision

`scripts/install-local.mjs` installs both as **symlinks**, not copies:

```sh
node scripts/install-local.mjs [--dry-run]
```

A link rather than a copy is what makes drift impossible: editing the clone changes what runs, and there is no second copy to fall behind. Git follows a symlinked hook, which was verified before the design was chosen.

The chain's source is `scripts/local/pre-commit.sh`. It carries an extension because the newline gate reads `**/*.sh` and a file named `pre-commit` would have been the one shipped file no check could see — Git takes the hook's name from the link, not from the source.

A target that already holds something else is kept beside itself as `<name>.bak.<unix-time>` before being replaced, and never deleted. That follows the standing order to back up configuration outside version control.

**A link is replaced, not backed up.** Renaming a link moves the path it holds rather than the file it names, so a "backup" made that way points at whatever the link said and dangles the moment that stops existing. A symlink carries no content to preserve, so it is unlinked and relinked; only a real file or directory is kept. The first version of this script renamed unconditionally, and its own second run produced a dangling backup that proved the rule.

When `core.hooksPath` is unset, or set to a relative path, the installer skips the chain and says so. Git reads each repository's own `.githooks/` in that case, so there is nothing to chain and nowhere to install it.

The installer is not shipped. `package.json`'s `files` lists `src`, `skills`, `templates`, and the two top-level documents, so this stays repository tooling rather than part of what a receiving project gets.

## Alternatives considered

**Copy the files instead of linking them.** Simpler to reason about, and it survives the clone being deleted. Rejected because a copy is a second version of a file that already has one, and nothing here can detect the two diverging — the failure this repository writes gates to prevent, in the one place no gate reaches.

**Publish the chain as a `git config` entry instead of a hook.** `core.hooksPath` could point at a directory holding both the chain and everything else, removing the indirection. Rejected because it replaces the user's existing hooks directory rather than extending it, which is the same silent loss the chain exists to avoid.

**Have the installer set `core.hooksPath` when it is unset.** Would make the tool self-sufficient on a fresh machine. Rejected because it is a global Git setting that changes behaviour in every repository the user touches, and the chain is only needed when some *other* value is already in the way. The installer reports the state and leaves the choice.

**Test it against the real `$HOME`.** The obvious way to check that the links land. Rejected because a test that rewrites the developer's Git configuration is not a test anyone can run; every case spawns the script with a sandbox `$HOME`. That sandbox must also set `XDG_CONFIG_HOME`, because `git config --global` reads the XDG location in preference to `~/.gitconfig` — a first version that overrode only `$HOME` read the real configuration and passed while testing nothing.

## Consequences

A new machine is set up with one command, and what it installs cannot drift from the versioned source. The script is covered by the package's own gates, including the newline rule, which the hook's own filename would otherwise have escaped.

The cost is a third thing to keep in step. The installer names two paths and one source file; moving `skills/agent-init-setup` or renaming the hook breaks it, and nothing checks that the sources exist before linking — a typo would produce a dangling link that looks installed. The tests cover the paths as they are, not the paths as they might be renamed.

A second cost is that the installer knows about one agent's skill directory, `~/.claude/skills`. It is the only one that matters here, but it is a hard-coded assumption about which tool reads the skill, and a user of a different agent gets the first half of the script and a link into a directory nothing reads.

A third cost is that the backup rule is narrower than it looks. Only a real file or directory is preserved; a link is replaced outright. That is correct for this package's own targets, which are either absent or already links, but a user who had replaced the hook link with a real script of their own edited content gets a backup, while one who replaced it with a link to their own script does not.

## Related

The skill this installs, and why it lives outside `templates/`, is in [The package ships its own setup skill](../feature/2026-09-16-the-package-ships-its-own-setup-skill.md). The three template forms and what a receiving repository owns are in [Layer stack profiles as additive overlays](../architecture/2026-09-15-layer-stack-profiles-as-overlays.md).
