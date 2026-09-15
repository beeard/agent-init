# Decision Record: Peer layers may not write the same path

Status: implemented

## Problem

Four language stacks each shipped a document at `docs/testing.md`. A template with no suffix is written, and the plan keeps the last write for a path, so a scaffold with two stacks delivered one language's testing guide and dropped the others. With all four applied, three documents vanished.

Nothing failed. `AGENTS.md` accumulated all four stacks' standing orders, and the Python section kept its line pointing at `docs/testing.md` — which by then held the TypeScript guide. The budget manifest had the same shape: four layers declared a ceiling for one path, the last one won, and the surviving ceiling described the surviving document. Every gate ran green on a scaffold that had lost three documents.

The dogfood matrix could not see it either. It gained `[all]` and `[two stacks]` for exactly this class of fault, but a matrix of compositions only runs gates over the composed tree, and a collision is not a gate failure: the document and its ceiling agree with each other, so there is nothing for a gate to disagree with. Only the plan knows which layer contributed which file, and the plan was not asking.

## Decision

A stack layer owns the documents it ships, and no two stack layers write the same path. Where several languages need the same subject, each ships its own file: `docs/testing-go.md`, `docs/testing-python.md`, `docs/testing-rust.md`, and `docs/testing-typescript.md`.

`buildPlan` refuses a path two stack layers both write, or that one stack writes and another stack contributes to. It refuses during planning, so nothing is written before it fires, and the caller sees a refusal rather than a partially scaffolded tree.

The rule is about peers. `base` and `architecture` are a hierarchy with a fixed order, and a later layer replacing an earlier one is what a `write` template is for — `templates/architecture/docs/architecture.md` deliberately replaces the base layer's skeleton with the plugin-specific map. Stacks have no such order, because the caller supplies it, so a path one stack writes and another stack also contributes to has no defensible winner.

Two appends, or two merges, at one path are composition and stay allowed: every layer's contribution is delivered, and the order decides only which section a reader meets first.

## Alternatives considered

**Compose the four guides into one `docs/testing.md` with `.append`.** This is the form the tool already provides for several layers contributing to one document, and it is what `AGENTS.md` does. Rejected because these documents are alternatives rather than sections: all four carry `## Layout`, `## Running`, `## What a test must own`, and `## Assertions`, so a composed file has four colliding anchors and no single owner for its title. It would also need a base `docs/testing.md` to append to, which would put a language-neutral testing guide into the base layer — a layer that is language-neutral by design, because a rule that holds for Python and Go alike is not a language rule at all.

**Let the base layer own `docs/testing.md` and have each stack append its section.** The same objection, plus a second one: it makes base the owner of a document base cannot write. Base knows nothing about how any language names or places its tests, which is the entire content of those four files.

**Keep one `docs/testing.md` and let the last stack win, documenting that stacks are order-sensitive.** Rejected because the order is not a decision anyone makes. `--stack python --stack typescript` and its reverse are the same request, and the tool would answer them differently while reporting success both times.

**Make the plan refuse any two layers writing one path.** Rejected because it contradicts the shipped contract: the suffix table states that a later layer writing the same path replaces it, and the architecture layer relies on exactly that. The refusal is narrow because the defect is narrow — peers with no order between them, not replacement in general.

**Rename the four documents and add no refusal.** The smallest change that fixes the files that are wrong today. Rejected because the next stack to ship a shared path reintroduces the same silent loss behind the same green gates. The rename is a consequence of the rule, not a substitute for it.

## Consequences

Every language's guide is delivered and budgeted on its own, and each budget is a plain number again rather than an object of contributions — a document one layer owns outright is the simple case the budget format was designed around.

The cost is that a scaffold with four stacks has four testing documents, and only the `testing-` prefix says they belong together. A reader asking how this repository tests things has to know which language they are working in first. That is the right question to be forced to answer, but it is no longer an optional one.

A second cost is that nothing checks the case the refusal excludes. A layer replacing a base document is permitted by design and invisible to the plan, so if base later adds a section to its skeleton that a replacing copy does not carry, the copy goes stale with no check reporting it. The rule stated here is narrower than "one layer owns each path", and the difference is exactly where the next instance of this fault can hide.

## Related

The three template forms and the layer contract are in [Layer stack profiles as additive overlays](2026-09-15-layer-stack-profiles-as-overlays.md); the budget format this decision simplifies for these documents is in [A shared document's budget is a sum of contributions](2026-09-16-shared-budgets-are-contributions.md).
