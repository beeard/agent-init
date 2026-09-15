# Glossary

Domain vocabulary for {{PROJECT}}. One canonical term per concept, and one concept per term. Terms link to their entry with a standard Markdown anchor; implementation detail stays in the owning module's README and in decision records.

Write a term here when it is used in more than one place and could reasonably be read two ways. Do not define a term that only its own module uses — that definition belongs in the module's README.

## capability seam

- **seam** — a *swappable capability* with three roles. A **Service Definition** owns the context key and declares the vocabulary: an abstract class or a concrete registry, never a bare TypeScript `interface`. One or more **Service Providers** implement it. One or more **Consumers** inject it, commonly a model-facing tool.

  The seam is the complete capability, never one of its roles. Reserve the word for that meaning, and name a constituent by its role, its class, or its service. A package may own more than one role when they are genuinely one concern; roles separate into their own modules when they evolve independently.

## composition

- **plugin** — a unit that contributes services, events, and behavior to a shared context, and whose contributions unwind when it unloads. Everything in the system is one.
- **context** — the repository of services a plugin is mounted into. A plugin finds a service by its key rather than importing a concrete implementation.
- **inject** — the declaration of a required service. A plugin that names one waits until it exists, so load order is expressed as requirements, never as manual sequencing.
- **effect** — a reversible registration. Everything a plugin contributes goes through one, so teardown is predictable.
- **bundle** — a distribution format for configuration entries and the code they mount.
- **profile** — a named composition: the bundles it stacks, the out-of-tree plugins it installs, and the user's patch file.

## events

- **notify** — a dispatch that observers receive in registration order, with no return value.
- **waterfall** — around-middleware. A listener receives a continuation and must call it to delegate; returning without it short-circuits the rest of the chain.
- **serial** — an awaited dispatch in registration order, whose return value is used.
- **parallel** — an awaited dispatch to every listener concurrently.
- **durable fact** — something recorded in the persistent log, reconstructable after a restart.
- **transient fact** — something observed while work is in flight, never stored.

## scope

- **extension point** — a documented place where new behavior attaches. Adding behavior anywhere else means the architecture map is out of date.
- **registration** — a contribution to a registry: a tool, a handler, a provider, a prompt section, a listener. Returns its own removal.
- **shadowing** — most-specific-wins name resolution, where a narrower registration replaces a broader one of the same name for its own scope alone.
- **explicit over implicit** — the rule that a default is applied by a visible resolution step in the implementation that owns it, never by a hidden fallback inside the operation.

## lifecycle

- **commit point** — the moment an operation has succeeded. State is published, and derived state recomputed, only after it.
- **quiescence** — the state in which no work is in flight and teardown can complete. A resource released before quiescence is a defect, even when it usually works.
- **fail loud** — the rule that a missing referent, an unknown variant, or an unreachable branch raises an error rather than degrading quietly.
