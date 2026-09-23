---
name: {{SLUG}}-prose-standard
description: Use when prose is the substance of the work in {{PROJECT}} — writing, reviewing, or trimming documentation, docstrings, agent prompts or skills, diagnostics, error text, or user-facing strings. Decides what must be said and what must be deleted. Not needed for a code change whose only prose is a routine commit message or a short comment; the comment rule in AGENTS.md covers those.
---

# Prose standard

Write enough to preserve the contract, then remove the reasoning, the repetition, and the decoration.

This skill covers required coverage and editorial judgment. Use the documentation standard in [docs/AGENTS.md](../../../docs/AGENTS.md) for placement, tiers, and budgets.

## What a contract is

A contract is an obligation, invariant, precondition, postcondition, or compatibility promise that a caller, callee, implementer, producer, or consumer relies on.

Preserve, wherever it applies:

- **behavior** — what it does, and what it returns
- **failure** — what it throws, rejects, or refuses, and when
- **timing** — ordering, concurrency, when a value becomes visible
- **ownership** — who allocates, who mutates, who disposes
- **modality** — required, optional, best-effort, guaranteed
- **exceptions** — the cases that break the general rule
- **consequences** — what changes if this is used wrong
- **orientation** — the non-obvious fact a reader needs to use it safely

Delete: narration of what the code does line by line, restatement of a signature, the path you took to arrive at the design, proofs of obvious branches, and test walkthroughs.

## Comments

A comment earns its place by saying something the code cannot. Before writing one, ask what a competent reader would get wrong without it.

Good comment subjects:

- why this order matters
- why the obvious approach does not work here
- which invariant the caller must maintain
- what this value is allowed to be, beyond its type
- that an empty `catch` is deliberate, and which error it expects

Bad comment subjects:

- what the next line does
- which ticket introduced the code
- how the code used to work
- what you tried first

Keep comments local. Do not expand an unrelated comment while you are nearby, and do not explain behavior that belongs to a different file.

## Terms to check, not ban

Some words are accurate and some are metaphors wearing a technical coat. Before using one, ask whether a more exact term names the subject.

| Term | Prefer when possible |
|---|---|
| contract | the exact obligation: preconditions, invariants, compatibility promise |
| boundary | the exact edge: process boundary, wire boundary, validation of input |
| shape | the exact structure: field set, response fields, JSON schema |
| surface | the exact thing: public API, exported symbols, command-line flags |
| gate | the exact check: the named script, rule, or assertion |
| seam | only a deliberately swappable capability with an interface, implementations, and consumers |
| vocabulary | the exact types, events, or terms being named |

Keep a term when it names the exact technical subject — a process boundary is a boundary, and a security boundary is a boundary. The check is whether a more precise word exists, not whether the word appears.

## Delete these

- **Duplicated rules.** Search a distinctive phrase; keep one home and link the rest.
- **History in present-tense prose.** "we used to", "this now", "no longer", "previously". State the current fact; link the decision record for the change.
- **Review and stack vantage.** "as discussed in review", "a later change in this series", "rejected because". Rationale belongs in the decision record, stated on its own terms.
- **Status annotations.** "implemented", "not yet wired up", "future: …". These rot silently.
- **Hand-restated catalogs or signatures** when a generator or the source is authoritative.
- **Paragraph walls.** One paragraph carrying several rules and parenthetical asides. Split it, or move the aside to its home.
- **Emphasis inflation.** Bold, capitals, or "critically" everywhere means nothing stands out. Reserve emphasis for the clause that changes behavior.
- **Hedged planning residue.** "it may be worth considering", "we should probably". Say what is, or say what is undecided and why.

## Rewriting an existing passage

Classify every proposition in the whole passage before changing any of it: a contract fact is kept, a duplicate becomes a link to its home, and reasoning is deleted. Then compare the rewrite against the original — if a caller could now do something wrong that the original warned them about, you cut too far.

Cutting is not the goal. A passage that is short and incomplete is worse than one that is long and correct — the failure this standard exists to prevent is a reader who cannot tell what the code promises.
