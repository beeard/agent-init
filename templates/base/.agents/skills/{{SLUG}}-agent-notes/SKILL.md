---
name: {{SLUG}}-agent-notes
description: Use when writing, updating, reviewing, superseding, archiving, or deleting a decision record in {{PROJECT}}. Covers when a change needs one, which class folder it belongs in, the required body sections, the supersession check every new record triggers, and the archival rules.
---

# Decision records

Use this skill whenever a change is non-trivial, or when a record needs auditing. The rules live in [.agents/notes/README.md](../../notes/README.md); this skill is the working procedure.

## Decide whether a record is needed

A change is non-trivial when it alters any of:

- observable behavior
- architecture, or how two parts of the system relate
- a contract shared across files or modules
- process, tooling, or repository workflow
- testing strategy or fixtures
- an on-disk, wire, or configuration format
- anything a maintainer may reasonably revisit later

If none apply, the change is mechanical or local and is exempt. If you are unsure, it is non-trivial — an extra record costs a paragraph; a missing one costs the rationale.

**Update before you add.** Search the active tree for a record that already owns this decision. Updating it satisfies the requirement; a second record covering the same ground is a defect.

## Pick the class

| Class | Use when |
|---|---|
| `feature` | You added a capability a user or agent can observe. |
| `bug-fix` | You corrected a defect, or closed a gap a postmortem surfaced. |
| `simplification` | You removed code, behavior, or surface without adding a capability. |
| `architecture` | You changed how the shipped source is structured, or the vocabulary the runtime uses. |
| `process` | You changed tooling, policy, or workflow around the code. |
| `testing` | You changed test infrastructure or strategy. |

Ask: does observable behavior change? If no, and you removed something, it is `simplification`, not `feature`.

## Pick the lifecycle

- The decision is unbuilt, or only partly built → `proposed/`
- The decision shipped → `implemented/`
- The proposal was declined → `rejected/`

The filename date is when the topic was **first proposed** per Git history, not today's date. A record that moves from `proposed/` to `implemented/` keeps its original date.

## Write the record

The header is exactly:

```markdown
# Decision Record: <title>

Status: implemented
```

The status must match the folder: `Status: proposed`, `Status: implemented`, or `Status: rejected — <why, in one line>`. No dates, no parentheticals.

Then `## Problem`, written so it stands without the solution. Someone who disagrees with your decision should still recognize their own problem in it.

`implemented/` continues with `## Decision` in the present tense, then `## Alternatives considered`, then `## Consequences`. Write what the trade-off cost **and** what it bought — a record that lists only costs is advocacy, not a record.

`proposed/` continues with `## Proposal`, then `## Alternatives considered`, `## Acceptance criteria`, `## Risks`.

**Never write `## Proposal`, `## Plan`, `## Migration plan`, or `## Acceptance criteria` in an implemented record.** The format gate rejects them. Once the decision shipped, a plan is history and an acceptance criterion is an obligation that either holds or does not.

## Alternatives considered

This section is mandatory and it is the reason these records exist. A decision recorded without what it beat invites re-litigation by the next person who has your idea.

For each genuine alternative, one bold-led paragraph: what it was, and why it lost. Use a `### Why not <X>?` subsection for one that was seriously contested.

Record alternatives that were actually considered. Do not invent a straw man to make the decision look stronger — a fabricated alternative is worse than an honest "this was the only option we found".

If an alternative lost for a reason that will expire — a missing upstream feature, a dependency that did not exist yet — say so explicitly. That is the condition under which the decision should be revisited.

## Supersession check

Run this for every new record, before you commit it.

1. **Search** the active tree for records covering the same mechanism or decision. Search by subject, not by filename.
2. **Classify** each hit:
   - **No overlap** — leave it.
   - **Partial supersession** — your record covers part of its ground. Keep both, cross-link them, and update every fact in the old one that is still current.
   - **Full supersession** — your record replaces it. Archive it if its rationale is complete, or consider consolidating it into yours if it is fully spent.
3. **Archive** every qualifying implemented record in the same change, following the archival rules below.

Consolidation — folding a spent record into the current owner and deleting it — is allowed only for full supersession. Before deleting, preserve every unique rationale, alternative, consequence, required verification, and named coverage gap, and repair every inbound link. Git history is not an acceptable sole copy of rationale.

## Archiving

Archive an implemented record when the decision is complete and its rationale is unlikely to guide future work.

**Keep it active** when any of these remains useful: the alternatives, the ownership boundary, a negative guarantee, durable or wire semantics, a security rule, or a condition under which the decision should be reintroduced.

Never archive a `proposed/` record — reject an obsolete proposal instead. Keep a `rejected/` record only while it prevents a plausible mistake; otherwise delete it.

To archive: move the file to `archived/{class}/`, keep `Status: implemented`, and insert `Archived: YYYY-MM-DD` immediately below the status line. Those are the only content changes permitted.

Once sealed, an archived record is frozen. Never edit, reformat, update, move, or delete it, and never treat it as authority for current behavior — it describes the past.

## Audit checklist

When reviewing records rather than writing one:

- Does every record's status match its folder?
- Does every implemented record describe what actually shipped, including paths and names that moved since?
- Does every record carry a real `## Alternatives considered`?
- Is there a pair of records covering the same decision that should be merged or cross-linked?
- Is any archived record being treated as current authority, or edited?
- Does any rejected record still earn its place?

## Finish

Run the gates:

```sh
node scripts/gates/run.mjs --group fast
```

Report which records you added, updated, superseded, or archived, and why.
