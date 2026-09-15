# Defensive patterns

Hard-won bug classes: each pattern below is a defect that actually shipped or nearly shipped somewhere, stated as the rule that prevents its recurrence. Read this before writing lifecycle, concurrency, subprocess, or teardown code.

These are not style preferences. Each one describes a failure that passes review, passes tests, and appears in production under load.

## Report orthogonal outcomes independently

A result can be several things at once — a process can time out **and** exit 0 because it trapped the signal. Surface each independent fact (`timedOut`, `signal`, `exitCode`) on its own.

Never nest one fact's report inside another's branch, or a caller reads a cut-short run as a clean success.

## Honor the public contract on both sides

When an implementation can produce one outcome in several forms, normalize them before returning through the public API.

If an inner layer may throw *or* return an error value, pick one form at the public boundary and document it where the type is defined. Otherwise every consumer has to guess whether a caught exception came from the dependency, a wrapper, or their own code — and each of them guesses differently.

Test every source form through the real consumer, not through the inner layer.

## Async state is not synchronous state

A status flag or an "idle" event is not the result of one unit of work. Several queued items, injected work, and retries can share one `running` interval, while cancellation can discard items that never started.

Never treat a coarse status as the completion of a specific request. A caller that truly owns a run must define its interval explicitly — from the durable receipt of its own input through the next whole-system idle — and describe any output as interval-wide rather than causally attributed to its request.

The rule cuts both ways: if the awaited transition can never occur, the wait hangs. Handle the "nothing to wait for" branch explicitly.

## Dispose must reach quiescence, not just request it

A teardown that issues kills or aborts and returns before the work stops leaves orphans.

Make cleanup await the children's exit — signal, then await completion. Close listener and notification registries **before** killing, so late completions stay silent instead of firing into a half-torn-down system.

## Contain callback exceptions in the dispatcher

A user-supplied listener that throws must not reject the promise it runs inside, and must not starve the listeners registered after it.

Wrap the dispatch loop so one bad subscriber never breaks the lifecycle it was observing.

## Never hand untrusted output the ambient environment or predictable paths

A spawned command inherits the parent's environment by default, including every credential in it. Give spawned commands a scrubbed environment, dropping names that look like secrets (`*KEY*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`), so credentials cannot leak into output, into an `env` dump, or into a spill file.

Temporary and spill files use a private directory (0700), random names, and exclusive owner-only creation (`'wx'`, mode `0o600`). A predictable, world-readable path invites a symlink race and discloses whatever the file holds.

## Unlink link-shaped paths

Removing a path that may be a symlink or a Windows junction must delete the **link**, not what it points at.

Check with `lstat`, then unlink: unlinking removes only the link and refuses a real directory, so it can never follow the link into its target. Recursive deletion is the dangerous case — on Windows it throws on a junction, and on other platforms it may descend through one into the target. Reserve recursive deletion for paths known to be real directories.
