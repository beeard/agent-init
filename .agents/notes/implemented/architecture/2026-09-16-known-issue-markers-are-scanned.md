# Decision Record: Known-issue markers are scanned, by position

Status: implemented

## Problem

The standing orders told an agent to flag known issues with `FIXME`, `TODO`, or `XXX` by urgency, and closed with the reason to bother: a clean scan is what makes the tags worth writing. No scan existed. The tags had no consumer, so the rule asked for a convention whose only benefit — sorting an unplanned backlog at a glance — arrived only if a reader already knew where to look.

The rule also stated no form. A tag that is a word in a comment can be written five ways, and the one that matters is the bare `TODO`: it tells a reader the problem was noticed and nothing about what is missing, which is the failure the tag was supposed to prevent.

Writing the scan showed why the form has to be part of the rule. A scan that looks for the three words reports every place that *names* the vocabulary: the standing orders line that defines it, the `todo-inventory` style constant listing the tags, and the gate's own regular expression. A scan that reports its own rule is worse than no scan, because a maintainer who sees it fires on the file that documents it stops believing its other findings.

## Decision

`verify-issue-tags` scans the repository's code and reports every known-issue marker with its location, tag, owner, and reason. It fails on one thing: a marker that names nothing.

**A marker is recognised by position.** The tag opens a comment — `// FIXME: reason`, `# TODO(owner): reason` — and the reason follows it. The comment opener is part of the match rather than a check beside it, which is what keeps a sentence about the vocabulary from reading as a marker.

**The corpus is code, not prose.** The documents that define the vocabulary are the ones most likely to name it, and a marker is a note to whoever changes the code beside it. The globs cover the formats this package ships a profile for, plus the JavaScript family and shell; a repository working in another language adds its extension, because it owns the file.

**The shared corpus policy moved to `lib/repo-files.mjs`.** Two gates now answer the same questions — which globs does the configuration declare, which directories does it skip, and what is staged — and two answers to those questions is how gates came to disagree before. `declaredGlobs`, `corpusSkipPredicate`, `REPOSITORY_SKIP_DIRECTORIES`, `stagedSources`, and `stagedSubset` are shared; `verify-final-newline` uses them rather than its own copies.

**A word-based scan is what the rule forbids**, so the gate reads position and states what that costs. Two consequences follow from being line-based and non-parsing. A tag that is not the first thing a comment says goes unreported, because the rule reads position rather than words. And a string that reads like a comment *is* reported, because telling a string from a comment takes a parser per language — a test fixture containing a bare tag is a finding, and giving it a reason is the fix.

## Alternatives considered

**Leave the tags a convention and delete the sentence that promises a scan.** The smallest change, and it makes the prose true. Rejected because it removes the only reason to use the tags at all: a vocabulary nobody checks is a preference, and the standing orders already carry enough of those. The rule was worth keeping, so the scan was worth writing.

**Ship the scan as a standalone report, like `change-scope.mjs`, registered in nothing and failing never.** Would make the sentence true without adding a gate that can fail a commit in every repository that adopts the tool. Rejected because the half of the rule that is checkable is exactly the half that makes the scan useful: a marker that names nothing cannot be sorted by urgency, so a report that lists it without complaint delivers the format's failure mode as a feature.

**Recognise a marker as the bare word, anywhere in a code file.** The obvious rule, and the one that finds the most markers. Rejected after trying it: it reported four findings in this package, all of them the vocabulary itself — this gate's own doc comment, its urgency list, and its regular expression. A scan whose first output is its own source teaches a reader to ignore it.

**Require the reason unconditionally, so `TODO:` with nothing after the colon is the only recognised form.** Would make the failure case impossible to write. Rejected because the bare tag is the form people actually write, and a gate that cannot see it cannot reject it — the marker would simply go unreported, which is the silence the rule exists to break.

**Scan prose as well as code.** A `TODO` in a guide is a real note to a reader. Rejected because the documents that define the vocabulary would be scanned by the gate that defines it, and the exception would have to be written into the corpus as a list of paths to skip — a second place to keep in step, and the shape of the defect the corpus rule was written to end.

## Consequences

The tags have a consumer. A reader runs one command and sees the whole unplanned backlog sorted by urgency, and a repository cannot quietly accumulate markers that say nothing.

The cost is a narrowed rule with an unenforced half. Nothing checks that a `FIXME` really blocks a release or that a `XXX` is really a someday — the tag is a claim, and the gate reads only its shape. The rule's first half remains a convention, and the record should not pretend otherwise.

A second cost is that the marker must be the first thing a comment says. A tag placed after a sentence — `// the parser is slow — TODO: profile this` — is invisible to the scan and therefore to the rule. The form is stated in the standing orders, so it is a rule a writer can follow, but it is a real narrowing of what counts as a marker.

The same root cause produces the opposite error, and it is the more visible one in practice. A line-based scan cannot tell a string from a comment, so a test fixture holding a bare tag is reported as a marker — this repository's own suite carries three, and `npm run check` counts them. That is noise rather than a false alarm, since a fixture with a reason silences it, but a reader who investigates the count finds test data and has to work out why. The alternative is a parser per language, which is the thing this gate exists not to be.

A third cost is that the code-glob list is fixed rather than derived. A layer that adds a language gets its markers scanned only if someone adds the extension, and the language profiles already declare their own globs that this list does not read. The list is complete for the four stacks that ship, and a stack that adds a fifth has one more file to update.

A fourth cost is that every repository adopting the tool now gets a gate that can fail on day one over markers it already has. `--lenient` marks it advisory with the rest, which is the same path every other rule takes on adoption.

## Related

The rule this gate enforces, and the gates it ships with, are in [Ship the gates with the rules](2026-09-15-gates-ship-with-the-rules.md). Where a gate takes its corpus and exclusions from is in [A gate's corpus comes from the configuration](2026-09-16-a-gates-corpus-comes-from-the-configuration.md).
