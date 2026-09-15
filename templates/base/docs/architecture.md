# Architecture

Read this before changing anything under the source tree. It is the map: what the parts are, how they compose, and where new behavior attaches. Rationale lives in [decision records](../.agents/notes/README.md); type definitions and per-module detail live in the owning READMEs.

> This file ships as a skeleton. Fill in each section as the system takes shape, and delete this notice. `verify-doc-budgets` caps the file — when the cap goes red, relocate detail to the owning README.

## The system in one paragraph

What {{PROJECT}} is, who uses it, and the single idea that explains its structure. Written so a new contributor can hold the whole thing in mind before reading any code.

## Components

| Component | Owns | Where it lives |
|---|---|---|
| … | … | … |

Describe each component by the responsibility it owns, not the files it contains. Link its README.

## How a request flows

The path a typical operation takes, from entry point to result, naming the components it crosses. A numbered sequence or a diagram, not prose narration.

## The seams

The places where an implementation is deliberately swappable, and what may be substituted. For each: what the interface promises, which implementations exist today, and who consumes it.

A seam is complete only when all three roles exist — the interface, at least one implementation, and at least one consumer. Naming one of the three is not a seam.

## Where new behavior goes

| Goal | Attach it here |
|---|---|
| … | … |

This table is the first thing to extend when the architecture changes, and the first place to look when deciding where a change belongs. Adding behavior outside a listed extension point means the map is out of date: update it in the same change.

## What is deliberately not here

The boundaries this system does not cross, and the capabilities it deliberately refuses. Negative guarantees are as load-bearing as positive ones, and are the first thing a later contributor will try to "fix".
