# Decision Record: Markdown blocks follow CommonMark

Status: implemented

## Problem

The Markdown gates tracked fenced code by comparing only the fence character. A backtick line inside a longer fence closed it, and a line such as a fence carrying an info string closed a fence it could not close, so the scanner swapped code and prose for the rest of the document. `verify-md-wrap` and `verify-md-links` then passed a wrapped paragraph or a broken link that followed, and `verify-agent-note-format`, which kept its own copy of the loop, rejected a valid record for a heading shown inside a nested fence.

The link extractor was one single-line regular expression. It missed titles in single quotes or parentheses, angle-bracket destinations, destinations with balanced parentheses, and every reference definition, and it reported links written inside code spans and indented code. `verify-md-wrap` read consecutive reference definitions as one wrapped paragraph.

Line endings were not normalised. `verify-agent-note-format` split on `\n`, so a record saved with CRLF endings failed its header checks, and `verify-final-newline` tested only for `\n\n`, so a file ending in two CRLFs passed.

## Decision

`lib/markdown.mjs` owns the block model and every Markdown gate uses it. `classifyLines` assigns each line one role after normalising CRLF and lone CR to LF: a fence opens on three or more backticks or tildes (a backtick fence's info string may not contain a backtick) and closes only on a run of the same character at least as long, with no info string, indented at most three columns beyond its container; indented code needs four columns beyond the enclosing list item's content column and cannot interrupt a paragraph; a link reference definition starts a block and cannot interrupt a paragraph either. `verify-agent-note-format` drops the lines `isCode` marks instead of keeping its own loop.

`extractLinkTargets` groups the lines of a paragraph and runs a small inline tokenizer over it. It honours backslash escapes, skips code spans and autolinks, matches link text by bracket depth, and parses `(destination title)` with angle-bracket destinations, balanced parentheses, and all three title forms. Every reference definition contributes its own destination, footnote definitions excepted; a reference-style link resolves to a definition, so checking the definitions checks every reference. An image inside link text is reported as well as the link. Fenced and indented code, frontmatter, and raw HTML lines are skipped.

`findWrappedParagraphs` flags a text line that directly follows a text line, so consecutive definitions are separate blocks. `verify-final-newline` counts the trailing line endings, LF or CRLF, and rejects zero or more than one. `verify-issue-tags` splits on either ending.

## Alternatives considered

**Adopt a Markdown parser package.** Would model every block and inline rule. Rejected for the reason [the gates ship with the rules](../architecture/2026-09-15-gates-ship-with-the-rules.md) gives: the scaffolded tool must run with no install step, so the package carries no dependencies.

**Patch the existing regular expressions.** Rejected because a link destination with balanced parentheses and a code span containing brackets are not regular, and each patch would move the false passes rather than end them. A tokenizer over Markdown is not the declaration scan the standing orders forbid: Markdown is the format these gates own, not a language whose own tooling exists to delegate to.

**Resolve each reference-style link to its definition and report it at the use.** Would report a broken target once per use. Rejected because the definition is the one place the target is written, so reporting it there names the line to fix, and an undefined reference is plain text by the specification.

## Consequences

The Markdown gates now agree on where code starts and stops, so a fence can no longer hide a violation from one gate while exposing it to another, and CRLF files are judged exactly as LF files are. The negative controls in `tests/gates.test.mjs` cover a false closing fence for the wrap, link, and format gates, each link form, reference definitions, code spans and indented code, and CRLF in every gate that parses lines.

The scanner still does not model HTML block extents or every list-nesting rule, and a reference definition whose title sits on a following line is recognised only when that line holds the title alone. A document relying on those forms may need a manual exception.
