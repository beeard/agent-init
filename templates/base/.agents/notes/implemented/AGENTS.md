# AGENTS.md — Implemented records

A record in this folder describes **shipped reality**, and is kept current with it.

When the code later moves a file, renames a module, changes a configuration key or default, or replaces a mechanism, update the record in the same change so it still describes where its decision lives. Paths, names, and structure are facts about the shipped system; keeping them accurate is required, not forbidden.

What you may not do is change the *decision*. A record that no longer matches the decision is superseded by a new record — leave the old one in place and cross-link the two.

Write in the present tense. `## Decision` states what is. Proposal-era headings are rejected here by `verify-agent-note-format`: no `## Proposal`, no `## Plan`, no `## Migration plan`, no `## Acceptance criteria`. A present-tense `## Testing`, `## Deferred`, or `## Related` section is welcome where it states fact.
