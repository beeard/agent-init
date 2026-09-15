# Architecture

Read this before changing anything under the source tree. This is the map: what the parts are, how they compose, and where new behavior attaches.

Rationale for past decisions lives in [decision records](../.agents/notes/README.md). The vocabulary used here is defined in the [glossary](glossary.md). How the system is assembled at startup is in [composition](composition.md).

## The system in one paragraph

What {{PROJECT}} is, who uses it, and the single idea that explains its structure. Write it so a new contributor can hold the whole thing in mind before reading any code. Then delete this instruction.

## The idea

Every part of this system is a **plugin**: a unit that contributes services, events, and behavior to a shared context. There is no privileged core to patch. You extend the system by mounting a plugin beside the others, and every registration unwinds when its plugin unloads.

This is the load-bearing decision, and most of the rules below follow from it. It is what makes a capability replaceable from configuration rather than from a fork, and it is why the answer to "where does this go?" is almost always "on an extension point", never "in the main loop".

## Components

| Component | Owns | `ctx` key | Where it lives |
|---|---|---|---|
| … | … | … | … |

Describe each component by the responsibility it owns, not the files it contains. Link its README.

## Capability seams

A **seam** is a swappable capability with three roles. All three must exist; naming one of them is not a seam.

- **Service Definition** — declares the interface and owns the context key. A definition is a class or a registry with behavior, never a bare TypeScript `interface`.
- **Service Provider** — implements it. There is usually more than one, and exactly one is mounted per composition.
- **Consumer** — injects the service and uses it, commonly a model-facing tool.

The roles live in separate modules when they evolve independently, and in one module when they are genuinely one concern. Adding a capability means designing all three.

Seams are why one provider swap changes the whole product. When two providers share one execution world — a filesystem and a subprocess provider pointed at the same remote host, for example — replacing that world moves everything built on it, with no per-consumer forks.

## The operation flow

The path a typical operation takes, from entry point to result, naming the components it crosses. A numbered sequence or a diagram, not prose narration.

Identify the boundaries where durable facts are recorded, and say which parts of the flow are synchronous with the caller and which are not.

## Where new behavior goes

| Goal | Attach it here |
|---|---|
| … | … |

This table is the first thing to extend when the architecture changes, and the first place to look when deciding where a change belongs.

**New behavior attaches to a documented extension point.** Changing the main loop or the core operation is not an extension — it is a change to this document, and the document updates in the same change.

## Laws

These hold across the whole system. A change that breaks one is a change to the architecture, not a local edit.

- **Model-visible means logged.** Anything that reaches a request must be reconstructable from the durable log, and a runtime check asserts it. A new model-visible input requires a new durable event.
- **Registrations are effects.** Every contribution is made through the context so it can be unwound. A registry's registration returns its own removal.
- **Declared dependencies, not boot order.** A plugin names what it requires and waits; load order is expressed as requirements, never as manual sequencing.
- **Explicit at boundaries.** Defaulting is a visible resolution step in the owning implementation, never a hidden fallback inside the operation.
- **Enforce where the decision is made.** A schema omission, a filtered list, or a listener ordering is not enforcement when another caller can bypass it.
- **Publish state only at its commit point.** Notify and derive only after the operation succeeds.
- **Fail loud at load.** Misconfiguration that is self-contained fails when the system starts, not on the first request that trips over it.

## What is deliberately not here

The boundaries this system does not cross, and the capabilities it deliberately refuses. Negative guarantees are as load-bearing as positive ones, and are the first thing a later contributor will try to "fix".
