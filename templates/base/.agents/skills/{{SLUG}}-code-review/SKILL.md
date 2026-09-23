---
name: {{SLUG}}-code-review
description: Use when reviewing a change in {{PROJECT}} — a pull request, a branch, or a working diff. Orients the reviewer to this repository's standards and to the checks that reading the code alone cannot show. Not for choosing which checks to run before a push.
---

# Code review

Read the change against the repository's own standards, not against general taste. The rules are in [AGENTS.md](../../../AGENTS.md), the map is in [docs/architecture.md](../../../docs/architecture.md), and the rationale for past decisions is in [.agents/notes/](../../notes/README.md).

Review is a check for **defects and drift**, not a preference poll. Every comment should name a concrete consequence.

## Establish the scope

```sh
node scripts/gates/change-scope.mjs --base <base-ref>
```

Read the whole change before commenting on any part of it. A line that looks wrong in isolation is often correct given a change three files away.

## What to look for

### Correctness

- **The failure path.** What happens on error, on cancellation, on a partial result? Is the resource released? Is state left consistent?
- **Bounds.** Are limits enforced on the complete value — including wrappers and metadata — or on an inner part that a caller can exceed?
- **Boundaries.** Is input validated where it actually enters — a parser, a wire message, a file, a subprocess — rather than deep inside where a direct caller bypasses it?
- **Discriminants.** Does a closed union end in an exhaustive check? Does an open one have a documented default?
- **Concurrency and teardown.** Is there one lifecycle owner per asynchronous operation? Can a callback fire after disposal?
- **Commit points.** Is state published only after the operation succeeds, or does a notification escape before the write that justifies it?

### Drift from the standards

- **Comment quality.** Reasoning transcripts, restatement of code, and history narration — see the `{{SLUG}}-prose-standard` skill.
- **One home per fact.** Is a rule now stated in two places?
- **Documentation currency.** Did the change invalidate a README, a documented type, or the architecture map without updating it?
- **A missing decision record.** Is this change non-trivial by the standard in [.agents/notes/README.md](../../notes/README.md#when-to-write-one)?
- **Duplicated mechanism.** Does the repository already do this, under another name?

### Design

- **Speculative generality.** An abstraction, option, or compatibility path with no current consumer. The rule is a current owner and a current need.
- **Hidden defaults.** A default applied inside the operation instead of a visible resolution step at the point of decision.
- **Hand-rolled where a dependency exists.** Would a maintained library genuinely delete code you would otherwise own and test?
- **Enforcement in the wrong place.** A guard implemented as a filter, a facade, or listener ordering that a direct caller can bypass. Enforcement belongs in the operation that makes the decision.
- **Silent skips.** A missing referent that falls through instead of failing loud.

### Tests

- **Behavior, not correctness.** Does the test name describe what the system does, or assert that the implementation matches itself?
- **The failure case.** Is the new failure path tested, or only the happy one?
- **Disposal.** For anything registered, is removal after teardown observed?
- **Isolation.** Does the test own every port, path, and child process it acquires? A test that passes only when run alone is a defect in the test.
- **Repeated evidence.** Does the change re-run a check that already covers this, rather than adding the narrow one that would fail?

## What to say

For each finding, state:

1. **Where** — file and line.
2. **What breaks** — the concrete input or state that produces a wrong result.
3. **Why it matters** — the consequence, not the principle.
4. **What would fix it**, when the fix is not obvious.

Rank by severity and put the most serious first. A review with twelve minor notes and one real defect buried at the bottom has failed.

If you find nothing, say so plainly. Manufacturing comments to appear thorough wastes the author's time and dilutes the ones that matter.

## What to leave out

- A summary of the diff; the author already has it.
- A request the repository's own standards do not require. Cite the rule or drop the comment.
- Style a formatter or linter already enforces — check whether the gate would catch it first.
- The change you would have written. Review the change that was written, against the standards the repository actually holds.
