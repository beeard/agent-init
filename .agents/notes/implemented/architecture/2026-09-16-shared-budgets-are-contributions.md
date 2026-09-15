# Decision Record: A shared document's budget is a sum of contributions

Status: implemented

## Problem

Several layers append to one document. Every layer also needs a word ceiling on that document, so the standing orders cannot grow without bound.

The first implementation had each layer declare an absolute ceiling for `AGENTS.md` in its `doc-budgets.manifest.json.merge`. Because a merge replaces a key, the last layer applied won: the ceiling became whichever layer happened to run last, regardless of how much the layers below it had added.

Applying one layer hid this. The ceiling was that layer's own number and the document was base plus that layer, so the two agreed by construction.

Applying several exposed it. A repository with all four stacks and the architecture layer produced a 2348-word `AGENTS.md` against a 1490-word ceiling, and the gate failed on a configuration the tool itself offers. The dogfood check never caught it because its matrix tested base, each layer alone, and each layer with architecture — never two layers that both append to the same document.

## Decision

A budget entry is either a number or an object of per-layer contributions, and a contribution object is summed.

```json
{ "AGENTS.md": { "base": 1200, "python": 290, "architecture": 390 } }
```

The base layer owns the document and declares the first contribution. Each later layer declares the share it adds. `verify-doc-budgets` sums the entries, and `--list` prints the breakdown so a reader can see which layer demanded the room.

To make this expressible, `.merge` gained one rule: **a key whose value is an object on both sides merges one level deeper; every other key is replaced.** That is what lets several layers each contribute to one shared value instead of overwriting it.

The two forms may not meet. A key the file and the template disagree about the shape of — an object on one side, a scalar or an array on the other — fails the run instead of being resolved. Composing a shared value and setting one outright are different intents, and the shape is what tells them apart: writing the template's shape over a scalar on disk drops the entries the file held, and reading a scalar as a contribution object sums in a share no layer declared. The refusal names the file, the key, and both shapes, and it is raised before that file is written.

This is what a repository adopted under the earlier absolute form hits on its first re-run: the file on disk says `"AGENTS.md": 890` and the template says `"AGENTS.md": { "python": 290 }`. Nothing in the merge can say which layer the 890 belonged to, and the run that guessed wrong would report a composed ceiling while silently cutting `AGENTS.md` to one layer's share. The way out is stated in the message: convert the entry by hand, or delete the file and re-run to rebuild it from the templates — which costs whatever entries only that file declared.

A document owned outright by one layer keeps a plain number.

## Alternatives considered

**Take the maximum instead of the last value.** A one-line change to the merge, and it fixes the immediate failure for ceilings that happen to be ordered. Rejected because it does not compose: each layer's number was written as base plus that layer alone, so the maximum of `base+python` and `base+architecture` is smaller than `base+python+architecture`. It would fail again as soon as three layers touched one document, and it would fail in the same silent way — the numbers look plausible in isolation.

**Let the base layer own the ceiling and drop it from the layers.** Simple, idempotent, and no merge change at all. Rejected because base cannot know which layers will follow, so its ceiling must either be loose enough for every combination — in which case it constrains nothing for the common single-layer repository — or tight, in which case a legitimate combination fails.

**Budget only the documents a layer owns outright, and not the shared one.** Removes the conflict entirely. Rejected because the shared document is exactly the one that grows: it is the standing orders, it is read in every session, and it is the reason a budget exists.

**Make numbers additive and keep the base manifest a plain file.** Would give the same composed result with a smaller change to the merge. Rejected because it is not idempotent: on a re-run without `--force` an existing file is kept, so every re-run would add the layer's share again and the ceilings would drift upward until they constrained nothing.

**Store the contributions in a sidecar keyed by layer.** Would keep the delivered manifest a flat map of numbers. Rejected as more moving parts for the same result: a second file to keep in sync, and a reader of the manifest would still have to look elsewhere to learn where a ceiling came from.

## Consequences

A shared document's ceiling composes correctly for any set of layers, and the `--list` output shows which layer asked for which share — which is what makes a surprising ceiling diagnosable rather than mysterious.

The cost is that `.merge` now has two rules instead of one: objects merge one level deeper, scalars replace. That is a small amount of implicit behavior in a mechanism whose whole purpose is to be predictable, and it is the kind of thing that is invisible until it surprises someone. The rule is stated in the merge function's own documentation, in the suffix table of the repository's standing orders, and in `docs/design.md`.

What keeps that from being a rule only a reader can apply is the refusal: the one case where the two forms meet is the case where guessing is destructive, and there the merge stops instead of choosing. A layer author who reads the rule will still write the right shape, and one who does not gets a message naming the key rather than a ceiling that quietly holds one layer's share.

A second cost is that a layer's contribution is a number a human estimates rather than one derived from the template. Nothing checks that a layer's declared share matches the words it actually appends; the check is on the delivered document, which is the number that matters.

The dogfood check gained two combinations — every layer at once, and two stacks together — because a matrix of single layers cannot detect a fault that only appears when two layers touch the same value.
