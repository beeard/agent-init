# AGENTS.md

Standing orders for agents working in {{PROJECT}}: the rules needed in context every session, one to three lines each, linking the document that owns the full rule. `CLAUDE.md` is a symlink to this file — edit `AGENTS.md`, never the link.

## Read before you change

- **Read a file before editing it.** Every rule below assumes you know what is already there.
- **[docs/architecture.md](docs/architecture.md) is the map** of how the system is put together. Read it before changing the code it describes.
- **[docs/defensive-patterns.md](docs/defensive-patterns.md) is required reading** before lifecycle, concurrency, subprocess, or teardown work. Each entry is a bug class that shipped somewhere, not a style preference.
- **Back up configuration before editing it** when the change falls outside version control: `<file>.bak.<unix-time>`.
- **Never edit a vendored or generated file by hand.** Find the source it comes from and change that.

## Working method

- **Do the smallest thing that fully solves the problem.** No speculative abstraction, no option nobody asked for, no compatibility path with no caller.
- **Tie every abstraction to a current consumer.** If nothing uses it today, it does not exist yet.
- **Prefer a maintained dependency over hand-rolled code** when it genuinely deletes code you would otherwise own and test.
- **Explicit beats implicit.** Put a default where it is decided and visible, as a named resolution step — never as a hidden fallback buried inside the operation.
- **Fail loud.** A missing referent, an unknown variant, or an unreachable branch is an error, never a silent skip. An empty `catch` names the error and why, and keeps its `try` to one statement.
- **Switch on discriminant tags**, and end a closed union with an exhaustive check. An open, extensible union falls through a documented default instead.
- **Flag known issues with `FIXME`, `TODO`, or `XXX`**, by urgency: `FIXME` blocks a release, `TODO` is soon, `XXX` is someday. Pick the tag that matches, so anyone scanning can tell a release blocker from a maybe. `verify-issue-tags` lists them all and rejects a tag that names nothing; a clean scan is what makes the tags worth writing.
- **Every file ends with exactly one newline.** `verify-final-newline` enforces it; an editor setting that adds one automatically is the easiest way to comply.
- **Comment the contract, not the reasoning.** Keep behavior, failure, timing, ownership, and the non-obvious orientation. Delete narration, restatement of the code, and the path you took to arrive at it.
- **Keep comments local.** Do not expand an unrelated comment or explain distant behavior that the reader does not need here.

## Evidence

- **Run the checks that cover your change before reporting it done**, and report the actual result — including a failure.
- **Match evidence to the surface.** Focused tests for behavior, the documentation gates for prose, a built check for packaging paths. Do not default to the full suite.
- **A red check is fixed, not bypassed.** If something fails, say so and stop; never lower a threshold, skip a test, or widen an ignore list to make it green.
- **Do not commit or push unless asked.** Never rewrite published history without an explicit instruction and a lease that aborts if the branch moved.

## Documentation

- **One physical line per paragraph.** Use editor soft-wrap; `verify-md-wrap` enforces it.
- **One home per fact.** Every fact lives in the tier whose job it is; everywhere else links there. Find a duplicate by searching a distinctive phrase.
- **Document current state.** History belongs in commits, pull requests, and decision records — not in prose that describes how things work now.
- **Update the documentation a change invalidates, in the same change**: the owning README, the function's contract, the architecture map.
- **[docs/AGENTS.md](docs/AGENTS.md) owns the documentation standard** — the tier table, the writing rules, and the word budgets.

## Decisions

- **Every non-trivial change adds or updates a decision record in the same change.** See [.agents/notes/README.md](.agents/notes/README.md). Only a mechanical or local edit is exempt.
- **A record states what was rejected and why.** A decision recorded without its alternatives invites re-litigation, which is the failure these records exist to prevent.
- **A record is superseded, never edited into a different decision.** Move it between lifecycles as its status changes, and keep both records cross-linked.

## Pull requests

- **One `kind/*` label, and every materially affected `area/*`.** The kind records the dominant intent: `feature` (adds or intentionally changes behavior), `bug-fix`, `doc`, `testing`, `cleanup` (preserves behavior while simplifying), or `dependency`. Tests and cleanup that accompany a feature do not change its kind.
- **Areas name durable subjects, not paths the change happened to touch.** Carrying two areas is normal for a change spanning two domains; an umbrella plus a narrower label for the same domain is not. Create a new `area/<name>` when nothing existing honestly covers a durable subject, and say so in the description rather than reusing a wrong one.
- **Split independent changes.** An unrelated fix in the same branch hides what broke and blocks a clean revert. Fix the change that introduced a defect rather than layering a correction on top.
- **Do not rewrite published history without a lease.** See the `{{SLUG}}-pre-push-checks` skill; a raw force-push discards a concurrent update silently.

## Checks

The whole-repository suite, which is what CI runs:

```sh
node scripts/gates/run.mjs
```

The subset the pre-commit hook runs:

```sh
node scripts/gates/run.mjs --group commit
```

Gates in the `commit` group receive `--staged`, so they inspect only what you are about to commit. That is what keeps the hook fast on a large repository; run the full suite before a push.

Scope a change against a base branch before deciding what evidence it needs:

```sh
node scripts/gates/change-scope.mjs --base origin/main
```

## Skills

Skills in [.agents/skills/](.agents/skills/) are reusable workflows with their own decision standards. Read the matching one before starting that kind of work:

| Skill | Use when |
|---|---|
| `{{SLUG}}-pre-push-checks` | Before pushing, force-pushing, or claiming checks pass |
| `{{SLUG}}-agent-notes` | Writing, auditing, archiving, or superseding a decision record |
| `{{SLUG}}-prose-standard` | Writing or trimming any prose: docs, comments, prompts, messages |
| `{{SLUG}}-code-review` | Reviewing a change against this repository's standards |

## Editing this file

Keep each rule self-contained and short, and link the document that owns the detail rather than restating it. `verify-doc-budgets` caps this file; when the cap goes red, relocate content to its home first, condense second, and raise the ceiling last — a ceiling that is genuinely too low is a bug in the budget, not a reason to delete a rule.
