# Decision Records

One kind of design document lives here. A **decision record** captures a decision that affects this codebase — the *why*, the *what we gave up*, and the verification that pins it. It carries the parts that code and documentation cannot.

This file defines where records live, when to write one, and their exact format.

## Layout and naming

Every record has two axes, both encoded in its path: `{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`.

**Lifecycle** — the top-level folder — is the record's status. A record moves between folders as that status changes:

- **`proposed/`** — reviewed before implementation; not built yet, or only partly.
- **`implemented/`** — the decision shipped. The file records what was decided and what was rejected, and is kept current with what actually shipped: when the code later moves a file, renames a module, or changes a key or default, the record is updated in the same change to match. Facts only — paths, names, structure — never the decision itself.
- **`rejected/`** — the proposal was considered and declined. Keep it only while its rationale prevents a tempting mistake; otherwise delete the file.

**Class** — the nested folder — is the kind of decision:

| Class | What it covers |
|---|---|
| `feature` | A new user- or agent-facing capability. |
| `bug-fix` | Corrects a defect, or closes a gap a postmortem surfaced. |
| `simplification` | Removes code, behavior, or surface area without adding a capability. |
| `architecture` | A structural decision about the shipped source: how components relate, what the runtime vocabulary is. |
| `process` | Tooling, policy, or workflow *around* the code — gates, dependency management, vendoring — not runtime behavior. |
| `testing` | Test infrastructure and strategy. |

The `architecture` / `process` line: architecture is about the source you ship; process is the surrounding tooling and workflow. There is deliberately no `refactor` class — it overlaps `simplification`, whose discriminator ("does observable behavior change?") already covers it.

The date in the filename is when the topic was **first proposed**, per Git history. Cross-references between records use relative Markdown links, never bare prose or numbers, so they survive a move between folders and stay checkable.

The tree is its own inventory: browse the lifecycle and class folders, or search the repository. There is deliberately no `INDEX.md` — a centralized index is a second place to update and goes stale.

## When to write one

Every non-trivial change adds or updates at least one record in the same change.

A change is non-trivial when it alters behavior, architecture, a contract shared across files or modules, process or tooling, testing strategy, an on-disk, wire, or configuration format, or any other decision a maintainer may reasonably revisit later.

Updating the record that already owns the decision satisfies the rule; do not create a duplicate. Only a purely mechanical or local edit — one with no change to behavior, contracts, structure, process, or rationale — is exempt.

A record is never edited into a *different* decision. Supersede it with a new record and keep both cross-linked. Editing an `implemented/` record so it still describes where its decision lives is required, not forbidden.

A record that is fully superseded may be consolidated into the current owning record and deleted. Before deleting, preserve every unique rationale, alternative, consequence, required verification, and named coverage gap, and repair every inbound link. Partial supersession does not qualify: keep both records and cross-link them.

## The file format

The first three lines are exactly:

```markdown
# Decision Record: <title>

Status: <status>
```

followed by a blank line. The `Status:` value must agree with the lifecycle folder:

- `Status: proposed`
- `Status: implemented`
- `Status: rejected — <why, in one line>`

The status carries no dates and no parentheticals: the filename holds the first-proposed date, Git holds everything else, and an "accepted in amended form" note is body content, stated where the decision is stated. The rejection reason is the one status with content, because a rejected record's verdict is the fact readers come for.

### The body skeleton

Every record opens its body with `## Problem` — the motivation, written so it stands without the solution. What follows depends on the lifecycle; the recurring sections use exactly these names, while genuinely bespoke technical sections (module topology, wire formats, schemas) sit free-form between them.

`proposed/`:

```markdown
## Problem
## Proposal
…bespoke sections…
## Alternatives considered
## Acceptance criteria
## Risks
```

`## Proposal` is the intended change and may speak in the future tense — plans, migration steps, and open questions belong here while the work is unbuilt. `## Acceptance criteria` says what observable state means done. `## Risks` covers both what could go wrong and what the change knowingly gives up.

`implemented/`:

```markdown
## Problem
## Decision
…bespoke sections…
## Alternatives considered
## Consequences
```

`## Decision` describes shipped reality in the present tense, and the file is kept current with it. `## Consequences` records what the trade-off cost **and** what it bought. Proposal-era headings are spec-speak here and the gate rejects them: `## Proposal`, `## Plan`, `## Migration plan`, and `## Acceptance criteria` may not appear in an implemented record. A present-tense `## Testing`, `## Deferred`, or `## Related` section is fine where it states fact.

`rejected/`:

A rejected record is the proposal, frozen. It keeps whatever proposal-time sections it had, including `## Acceptance criteria` or `## Plan`, and the verdict lives on the `Status:` line. Only the header block, the `## Problem` opener, a `## Proposal` section, and the mandatory alternatives section apply.

### Alternatives considered

Every record carries an `## Alternatives considered` section: each genuine alternative and why it lost, one bold-led paragraph per alternative or a `### Why not <X>?` subsection per contested one.

Alternatives are recorded, never invented.

### Moving between lifecycles

Moving a file between lifecycle folders means updating the `Status:` line and re-satisfying that folder's skeleton in the same change — the gate fails the move otherwise. Concretely, `proposed/` → `implemented/` rewrites `## Proposal` into a present-tense `## Decision`, folds `## Acceptance criteria` and `## Risks` into `## Consequences` or a present-tense `## Testing` section for what now pins the behavior, and drops plans in favor of what shipped. `proposed/` → `rejected/` only adds the reason to the `Status:` line and freezes the file.

## Archiving

Archive an implemented record when the shipped decision is complete and its rationale is unlikely to guide future work.

Keep it active when its alternatives, ownership boundary, negative guarantee, durable or wire semantics, security rule, or reintroduction condition remains useful. Never archive a proposed record — reject an obsolete proposal instead. Keep a rejected record only while it prevents a plausible mistake; otherwise delete it.

The archive is path-encoded as `archived/{class}/yyyy-mm-dd-topic-title.md`. `implemented` is deliberately absent from that path, because only implemented records can enter it. Archiving moves the file, retains `Status: implemented`, and inserts an `Archived: YYYY-MM-DD` line immediately below the status. Those are the only permitted content changes.

Once sealed, every archived record is permanently frozen. Do not edit, reformat, update, move, or delete it, and never treat it as authority for current behavior. Active prose may still link into one when it intentionally cites history.

## Enforcement

| Gate | Checks |
|---|---|
| `verify-agent-note-tree` | Lifecycle and class folders, filename dates, one file per topic |
| `verify-agent-note-format` | Header block, required sections, banned sections, alternatives |

Both run as part of `node scripts/gates/run.mjs`.
