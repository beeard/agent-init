# Decision Record: The merge reports what it changed

Status: implemented

## Problem

`mergeJson` derived its report from the top-level keys of the incoming template alone: a key the file did not already hold was listed as added, and a merge that added none printed `no new keys`. That became false the moment the merge gained its second rule. A layer contributing a share to a shared value changes the file without adding a top-level key, so `--stack go` over a Python scaffold reported a no-op on a manifest that had just gained `"go": 260` to a ceiling.

The report is the tool's only account of what it wrote. It is what an ordinary run prints, and it is what `--dry-run` exists to show, so a maintainer explaining why a ceiling moved was told the run changed nothing.

## Decision

The detail is derived inside the loop that performs the merge, where each key's outcome is known. A top-level key the file did not have is `+ key`; entries contributed to a shared value are `+ entries in key`; an existing entry written with a different value is `changed ...`; and a merge that writes what the file already holds is `already present`.

Values are compared by their serialized form rather than by identity. A template and a file are parsed separately, so two equal arrays are never the same object, and an identity comparison reported every list-valued key as changed on a re-run that had written exactly what the file already contained.

## Alternatives considered

**Report only that the file was merged, with no detail.** Removes the possibility of a false report by removing the report. Rejected because the detail is what separates a merge that extended a shared value from one that replaced an entry, which is the difference between a ceiling that grew and one that was cut, and `--dry-run` would then print nothing worth reading.

**Compare `base` against `merged` once, after the loop.** Derives the report from what the merge actually produced rather than from what it intended, which is the stronger guarantee. Rejected because an honest version of that comparison is a deep diff, and the result would still have to be named in terms a reader recognises — "`AGENTS.md` gained `go`" — which is the classification the loop already has in hand.

**Keep counting top-level keys and phrase the detail so it is true either way.** A single word like `merged` would never be wrong. Rejected as the same false precision in a smaller font: the reader still cannot tell an extended ceiling from a replaced one.

## Consequences

A run names the change that matters, and a re-run that writes what is already there says so instead of listing entries it did not touch. The vocabulary has three shapes — added, changed, and unchanged — and the merge is the only place that can produce them.

The cost is that the detail is a list of phrases rather than a list of key names, so a merge touching many entries prints a longer line. The report is one line per file, and a merge wide enough to matter is rare.

A second cost is that comparing by serialized value is order-sensitive for an object nested inside a shared value: the same entries in a different order read as a change. Every file this tool writes comes from one serializer, so its own output never triggers it, but a hand-edit that reordered a nested object's keys would report that entry as changed on the next merge.

## Related

A differing entry the file already held is now kept and reported as kept unless `--force`; see [A re-run keeps what the repository owns](2026-09-23-a-re-run-keeps-what-the-repository-owns.md), which partly supersedes the `changed` report described here.
