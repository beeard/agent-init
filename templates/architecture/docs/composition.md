# Composition

How a running {{PROJECT}} is assembled from parts. The parts themselves are described in [architecture.md](architecture.md); this document covers how they are put together.

## Layers

A running system is a plugin tree composed at boot from ordered layers:

```text
bundles, in the profile's listed order
  → the profile's own patch file
  → the machine-level patch file
  → any command-line overlay
```

Each layer applies to the result of the previous one. A patch targets an existing entry by id and replaces its whole configuration, or inserts new entries.

The consequence worth internalizing: **every entry the system actually booted with is replaceable from configuration**. Dump the composed tree, pick a row, and patch it. If a behavior cannot be reached that way, it is hardcoded, and hardcoded behavior is a defect rather than a design.

## Profiles and bundles

A **profile** is a named composition: the bundles it stacks, any out-of-tree plugins it installs, and the user's own patch file.

A **bundle** is a distribution format for configuration entries and the code they mount. A bundle declares itself in its own package manifest, so whatever it inserts stays patchable by the layers above it.

There is deliberately no second way to compose an application. A new entry point, a hidden command-line mode, or an inline tree assembled by a caller all bypass the patch chain, which means the deployment can no longer adjust them. Composition is a profile plus ordered patches, and nothing else.

## Hot reload

Changing a layer can reload it live, or require a restart. Choose per application, and choose deliberately:

- A long-running interactive application reloads live, because its dependencies can be replaced while it runs.
- A one-shot process or a stdio server applies its layers once at startup, because replacing its dependencies after it owns work would invalidate the lifecycle it is already in.

Mixing the two — a live reload in a process that has handed ownership of a resource to a component — is the failure this distinction prevents. State which mode an application uses, and why, where that application is defined.

## Effects

Everything a plugin contributes is registered through the context, and every registration is reversible. When a plugin unloads — a reload, a teardown, a test finishing — its contributions unwind in the intended order.

Two consequences:

- **A registration returns its own removal.** A registry that cannot be unwound leaks across reloads, and the leak is invisible until the second load.
- **Teardown order is a design decision, not an accident.** If the order matters, keep the related work in one effect so disposal unwinds in the sequence you chose.

Prove disposal, do not assume it: unload the plugin and observe that its contribution is gone.

## Dispatch modes

Events are the extension points, and the mode is part of an event's contract, not an implementation detail.

| Mode | Awaited | Order | Returns |
|---|---|---|---|
| notify | no | registration order | nothing |
| waterfall | no | registration order | a value, wrapped by each listener |
| parallel | yes | concurrent | nothing |
| serial | yes | registration order | a value |

A **waterfall** listener receives the arguments plus a continuation. It must call the continuation to delegate, and returns without calling it only when it deliberately owns the decision and is short-circuiting the rest of the chain. A listener that merely observes must always delegate — forgetting to is the most common defect in this model, because the symptom is a downstream listener silently never running.

## Choosing a domain

Before adding an event or a listener, decide which kind of fact you are publishing:

- A **durable fact** that must survive a restart belongs in the persistent log, and is broadcast to everyone.
- A **transient fact** about work in flight belongs on the live domain, and is observed or intercepted but not stored.
- A **policy or adapter** belongs attached to the seam it governs, so the component that owns that seam does not have to import the policy.

Picking the wrong domain is the most expensive mistake in this architecture, because a durable fact placed on the transient domain cannot be replayed, and a transient fact placed on the durable domain bloats the log with noise nobody can reconstruct from.
