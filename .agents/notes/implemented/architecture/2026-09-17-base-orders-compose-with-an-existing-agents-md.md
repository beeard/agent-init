# Decision Record: Base orders compose with an existing AGENTS.md

Status: implemented

## Problem

The base layer's root `AGENTS.md` was a `write` template, so adopting this structure into a repository that already had an `AGENTS.md` kept that file and never delivered the base standing orders. `create-next-app` ships its own `AGENTS.md`, and a real run against a Next.js project produced exactly that: the repository's Next.js rules, plus the appended `## TypeScript` section, and none of `Read before you change`, `One home per fact`, or the rest of the base. The appended section opens with "These orders apply in addition to the general ones above", so the composed document referred to orders that were not there.

A plain `.append` does not fix it either. `appendFile` treats a file without the layer's marker as one that has not received the section, so a repository that adopted the structure, was written a root `AGENTS.md`, and then had that file edited by hand would be handed a second copy of the base orders on the next run. The marker that would have prevented it is exactly the thing an edit can remove.

## Decision

A fourth template form, `.compose`, applies a template by the state of the target and the adoption manifest:

- **No file** → written as-is, so a fresh repository gets the document and not a wrapper. This is what the root `AGENTS.md` does in every fresh scaffold, and its output is unchanged.
- **A file, and `.agents/manifest.json` is absent** → the content is appended inside the layer's `<!-- agent-init:begin <layer> -->` markers. The repository's own file is preserved verbatim and the orders arrive as a section. This is the adoption case.
- **A file, and the manifest is present** → kept. The repository has adopted the structure, so the file is its own and every later edit survives.

`templates/base/AGENTS.md` became `templates/base/AGENTS.md.compose`. The manifest is read before anything is written, and it is written last, so the first run of an adoption sees no manifest and composes while every later run sees one and keeps.

`.compose` counts as a replacing kind wherever a `write` does: one compose survives per path in `dedupe`, and it conflicts with a peer stack's write the same way.

## Alternatives considered

**Keep the `write`, and report that the base orders are missing.** Non-destructive and small. Rejected because it leaves the product's own central document undelivered, and the gates then enforce rules the repository was never given.

**Change `appendFile` so an absent file is written unwrapped, and skip when the content already matches.** No new form. Rejected because content equality cannot tell a file this tool wrote from one the repository happened to write with the same text, and any hand edit makes the two differ, which reintroduces the second-copy failure.

**Always wrap the base `AGENTS.md`, by shipping it as `.append`.** Uniform with the other layers. Rejected because it changes what every fresh repository gets, putting tool markers around a document that is not a contribution to someone else's file.

**Special-case the `AGENTS.md` path inside `applyPlan`.** No template contract change. Rejected because a path that behaves unlike its suffix is the kind of hidden rule the three-form contract exists to prevent, and the next file that needs it would add another special case.

## Consequences

Adopting into a repository with its own `AGENTS.md` now delivers the base orders as a marked section above the stack sections, so "the general ones above" is true. A fresh repository's `AGENTS.md` is byte-for-byte what it was.

The base document is no longer a `write`, so a repository that adopted before this change keeps the file it has and does not gain the base section on a re-run; the marker has to be added by hand, or the file deleted and re-run. The public template contract is now four forms rather than three, documented in `AGENTS.md` and `docs/design.md`.

`docs/design.md`'s ceiling rose from 1320 to 1500 words. Two mechanisms were documented into a file that already sat five words under its ceiling, and the manifest's own rule is that a ceiling too low to hold a real document is a budget bug.

## Related

What the marker is for, and why a second layer appending needs its own, is in [Layer stack profiles as additive overlays](2026-09-15-layer-stack-profiles-as-overlays.md). Why the TypeScript layer now writes a config into the repository is in [TypeScript projects are initialised, not just annotated](../feature/2026-09-17-typescript-projects-are-initialised.md).

A file that already carries the base orders is now kept even without the manifest, and a failed run writes nothing; see [A re-run keeps what the repository owns](../bug-fix/2026-09-23-a-re-run-keeps-what-the-repository-owns.md), which partly supersedes the "no manifest → appended" case above.
