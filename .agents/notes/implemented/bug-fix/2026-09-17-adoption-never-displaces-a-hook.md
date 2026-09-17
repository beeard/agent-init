# Decision Record: Adoption never displaces a hook

Status: implemented

## Problem

`installHook` wrote `.githooks/pre-commit` with an unconditional `writeFileSync`, then pointed `core.hooksPath` at `.githooks` whenever its *local* value was empty. Three failures followed. A repository that already had its own `.githooks/pre-commit` lost it on the first run, and a second run reverted edits to the hook the tool had written. On a machine with a global `core.hooksPath` — the chain [Machine-local pieces are installed by link](../process/2026-09-16-machine-local-pieces-are-installed-by-link.md) installs — the local read saw nothing, so the tool wrote a local value over the global one and every global hook stopped running for that repository. And pointing the path at `.githooks` makes Git stop reading `$GIT_DIR/hooks`, so a repository's own hook there was dropped without a word.

`README.md` promised that existing files are kept unless `--force` is given, and `docs/design.md` promised the tool does not overwrite, so the behavior contradicted the stated contract as well as the record whose rejected alternative names exactly this loss.

## Decision

`installHook` displaces nothing without `--force`:

- An existing `.githooks/pre-commit` whose content is not the tool's own is kept, the run reports `kept`, and the note says how to wire the gates into it. `--force` replaces it.
- `core.hooksPath` is read across every scope. A global or system value is reported as already configured and the marker `agent-init.githooks=true` is set, because a chain in that directory is what can run the repository's hook.
- When `core.hooksPath` is unset and `$GIT_DIR/hooks` already holds an executable hook, the path is left unset on the same reasoning, and the run reports `not activated` with the command that would change it.

The hook file is written in every case, so nothing is lost: the repository can enable the path by hand, and a chain that reads the marker can run the file.

## Alternatives considered

**Keep overwriting, and document it.** Rejected because the loss is silent at the moment it happens, and `.githooks/pre-commit` is where a repository's own commit policy lives.

**Chain a pre-existing `.git/hooks/pre-commit` from the installed hook.** Would preserve both behaviors automatically. Rejected because the installed hook would then run repository-owned code it did not run before, and because chaining is where this repository's recursion guard already had to be added once.

**Read the global value but still write a local one.** Rejected because a local value hides the global directory for that repository — the silent loss the global chain exists to prevent.

## Consequences

Adoption is safe on a repository that already has hooks, at the cost of the gates not running on commit until the repository wires them in or enables the path by hand. The run names which case it took, so the state is never a guess.

The global-scope read turns a machine-wide `core.hooksPath` into `not activated` plus the marker, where the previous version reported `activated` while disabling the global hooks. That is the correct direction, and it is a behavior change for repositories scaffolded on such a machine.

## Related

What the marker is for and why it lives in `.git/config` is in [Machine-local pieces are installed by link](../process/2026-09-16-machine-local-pieces-are-installed-by-link.md).
