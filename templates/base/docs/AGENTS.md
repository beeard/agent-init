# AGENTS.md — The documentation standard

This file defines document structure, the tier taxonomy, writing rules, and the word budgets. It applies to human-facing documentation; [decision records](../.agents/notes/README.md) are outside its scope.

## Document structure

A document's subject and its position in the tree fix its scope. Describe its own subject at the appropriate detail, and its direct children only by purpose, responsibility, and high-level behavior; link to the owning descendant for anything lower. Document type does not widen that scope: a reference may be exhaustive only about its own subject.

Classify every in-scope document as a **tutorial** or a **reference**.

- A **tutorial** follows an ordered path to an outcome and introduces only what each step needs.
- A **reference** defines a lookup scope and states current behavior, with no teaching sequence.

Keep substantial tutorial and reference content separate. When either part is small, label the section instead of splitting the file.

Before writing a tutorial, classify the reader's starting knowledge and each concept as beginner, intermediate, or advanced. Establish prerequisites before the concepts that depend on them, increase difficulty gradually, and move advanced material that the path does not need into a later tutorial or a reference.

## One home per fact

Every fact has one home: the tier whose job it is. Everywhere else links there.

| Tier | Job | Does not belong |
|---|---|---|
| Root `AGENTS.md` | Standing orders an agent needs in context every session, one to three lines each, linking the owner | Stories, worked examples, procedures, anything restated from a linked home |
| Subtree `AGENTS.md` | Orders specific to that subtree | Rules the root file already carries |
| `docs/architecture.md` | The system map: how the parts compose, the core modules, the seams, and where new behavior attaches | Type definitions, per-module detail, decision rationale |
| Decision records | The why, the what was given up, and the required verification | Migration plans and acceptance checklists once the decision shipped |
| Per-module README | That module's contract: configuration, semantics, limitations, extension points | Restated signatures, other modules' concerns |
| Tutorials and guides | Step-by-step procedures with numbered verification steps | Design rationale — link the decision record instead |

Placement: a defect's story goes in a postmortem, rationale in a decision record, a procedure in a guide, a contract in the owning README, a standing order in the root `AGENTS.md` with a link to its rationale.

## Writing rules

- **Document current state.** Keep history in commits, pull requests, and decision records. Prose elsewhere names live mechanisms, not changes.
- **One physical line per paragraph.** Use editor soft-wrap. Code blocks, tables, and list structure keep their formatting.
- **Every non-trivial change includes a decision record in the same change.** Update the owning record or add one.
- **Comments and docstrings state complete contracts, not reasoning transcripts.** Preserve behavior, failure, timing, ownership, modality, exceptions, and consequences. Delete narration, test walkthroughs, and restatement of the code. Use the `{{SLUG}}-prose-standard` skill.
- **Write directly: name actors and facts.** Prefer the exact rule, type, field, or operation over a metaphor. Reserve a technical term for the thing it names.
- **Use relative Markdown links for current files**, and PR or issue numbers for historical references. `verify-md-links` checks local targets.

## Word budgets

[scripts/gates/doc-budgets.manifest.json](../scripts/gates/doc-budgets.manifest.json) sets ceilings for standing documents. `verify-doc-budgets` rejects a document over its ceiling and a listed document that no longer exists.

When the gate goes red:

1. **Relocate** content that belongs in another tier, leaving a one-line link if needed.
2. **Condense** content that belongs here but can be shorter.
3. **Raise** the ceiling only when the words genuinely need the space, and justify the manifest change in the pull request. A ceiling that is too low is a budget bug.

Ceilings are guardrails, not reduction targets. A budgeted document at or below target keeps at least 5% headroom; a document above target freezes its ceiling until relocation or condensation brings it back under.

## The slop checklist

Hunt these in any document:

- **Duplicated rules.** Search a distinctive phrase; keep one home and link the rest.
- **History outside its permitted tier.** State the current fact and link the historical owner.
- **Status annotations** ("implemented", "future: …"). Status rots; the tree and the manifests carry it.
- **Hand-restated catalogs or signatures** when a generator or the source is authoritative.
- **Reasoning transcripts.** Step-by-step narration, proofs of obvious branches, test walkthroughs, and rejected local alternatives. Keep the resulting contract or durable rationale; delete the path used to derive it.
- **Paragraph walls.** One paragraph carrying several rules and asides.
- **Emphasis inflation.** Bold or capitals everywhere means nothing stands out. Reserve emphasis for the clause that changes behavior.
- **Spec-speak in an implemented decision record.** "should", migration plans, acceptance checklists. An implemented record states what is.
