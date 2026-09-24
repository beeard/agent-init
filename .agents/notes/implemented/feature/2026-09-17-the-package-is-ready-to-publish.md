# Decision Record: The package is ready to publish

Status: implemented

## Problem

`agent-init` was installable only from a clone on one machine. Nothing about the tool required that — no runtime dependencies, `npm pack` produced a self-contained tree — but every path to it was closed:

- No package was published, and `npm view agent-init` answered 404.
- The GitHub remote is private, so there was nothing to clone.
- The setup skill's own first step, `command -v agent-init || ls ./*/src/cli.mjs`, succeeds only where the clone or the link already exists.

Three smaller gaps followed from the same place. `package.json` declared `"license": "MIT"` with no `LICENSE` file beside it, which is the one omission a reader evaluating a tool that writes into their repository notices first. It declared no `repository`, `homepage`, or `bugs`, so the npm page would have carried no link back. And the packaged skill was unreachable to anyone who installed through npm: `scripts/install-local.mjs` links it, and that script is deliberately not in the published `files` list, because it installs the hook chain for a clone.

The name itself was a fourth gap, and it only appeared when the first publish was attempted. `npm publish` rejects `agent-init` outright:

```text
403 Package name too similar to existing package agentinit; try renaming your package
```

`agentinit` is not a squatter: it is an active package in the same subject area, and npm will not carry a name one hyphen away from it. The check runs at publish time, so no amount of looking the name up beforehand would have found it — `npm view agent-init` answered 404, which reads exactly like "available".

## Decision

**The package is `@beeard/agent-init`, published with `--access public`.** The scope is what makes the name registrable at all, and it is also the convention here: `agent-init` already exists in the registry twice under other scopes, so a reader looking for this tool meets a namespace rather than a collision. The `bin` entry stays `agent-init`, so the command a user types is unchanged — only the `npx` specifier carries the scope.

**A `LICENSE` file with the MIT text**, and `package.json` now names `repository`, `homepage`, `bugs`, and `author`. `LICENSE` joins the `files` list, so it is in the published tarball rather than only in the repository.

**`@beeard/agent-init --install-skill` installs the setup skill**, in `src/skill-install.mjs`:

```sh
npx @beeard/agent-init --install-skill              # copies into ~/.claude/skills/
npx @beeard/agent-init --install-skill --link       # symlinks instead
npx @beeard/agent-init --install-skill --skill-dir <path>
```

The command is `agent-init`, from `bin`, whatever the package is called; only the `npx` specifier carries the scope.

**It copies by default.** `npx` runs the package from a directory npm is free to prune, and a symlink into a pruned path is a skill that reads as installed and works never — the failure mode the whole feature exists to prevent. `--link` is for the case where the package will not move. The clone's installer keeps linking, which is what makes edits to the clone take effect and what keeps the two from drifting on one machine.

**A copy the user edited is kept beside itself**, as `<name>.bak.<unix-time>`, with a `-<n>` suffix when that stamp is taken. A skill installed into a home directory is the user's to edit, so a second install reports `replaced` and names the backup rather than overwriting work.

**It refuses to run beside scaffold options.** `--stack`, `--lenient`, `--force`, a target positional, and the rest are rejected with a message naming them, because `--install-skill` scaffolds nothing: a run that silently dropped `--stack python` and installed a skill would report success for work it never did. `--link` and `--skill-dir` are rejected without `--install-skill`, for the mirror reason.

**The path arithmetic is shared; the rendering is not.** `src/skill-install.mjs` owns where the skill goes and what each collision is called, and both the CLI and `scripts/install-local.mjs` use it. Rendering stays with each caller, because the clone installer shortens `$HOME` to `~` and the CLI prints the path it was given.

**`bin` names the CLI without a leading `./`.** `npm publish` warns that `"./src/cli.mjs"` is an invalid script name and removes the entry, which would leave the published package with no `agent-init` command at all: every `npx` line in this repository's own documentation would fail, and the failure would appear only after publishing. `npm pkg fix` rewrote it.

**`engines` states `>=20.11`, not `>=20`.** `import.meta.dirname` reaches every gate, so an older 20.x satisfies the range, installs, and fails at the first gate run. The floor is the version that actually works, and the README and the external-agent prompt say the same number.

**Line endings are declared in `.gitattributes`.** The package ships a shell hook that Git must be able to execute and gates that read text, so a checkout that rewrote either to CRLF would break a repository this one never sees. `text=auto` still lets Git detect binary content.

## Testing

`.github/workflows/check.yml` runs `npm test` and `npm run check` on every push and pull request, on Node 20.11 and the current release. The repository's standing orders already said both must pass before a change is reported as done; until now nothing enforced it on a change that arrived from anywhere else, and the floor version in `engines` was a claim nobody ran.

The runner image carries Python, Go, and Rust, and the workflow installs the `typescript` package so the TypeScript gate resolves a compiler instead of a missing toolchain — a stack gate that cannot reach its toolchain fails loud, which under `check.mjs` would surface as a failing composed run for a reason that has nothing to do with the change.

What the workflow does **not** verify: the registry round trip, which was verified by hand instead. `@beeard/agent-init@0.1.0` is published and fetched back from the registry with a fresh cache: `npm view` reports the version, `bin`, `license`, and `repository`, `npx @beeard/agent-init@0.1.0 --install-skill` copies the skill into an empty `$HOME`, and `npx @beeard/agent-init@0.1.0 . --stack python` scaffolds a repository whose eight gates then pass. The GitHub URLs in `package.json` answered 404 until the repository was made public.

## Alternatives considered

**Make the user link the skill by hand, as the README already said.** Zero new surface, and it is what the clone workflow needs anyway. Rejected because it is exactly the step an npm user cannot perform: there is no clone to link to, and the README's `ln -s /path/to/agent-init/...` names a path they do not have.

**A `postinstall` script that installs the skill automatically.** Would remove the flag entirely. Rejected because it contradicts the boundary already recorded for `agent-init.githooks`: a package must not write outside its own tree without being asked, and `postinstall` is the pattern users disable with `--ignore-scripts`. The whole point is that the user asks.

**`--link` by default, matching `install-local.mjs`.** Consistent with the clone workflow. Rejected because the two situations differ in the one way that matters: a clone does not move and an `_npx` directory is pruned. Consistency between them would mean prescribing the option that breaks after a cache eviction.

**Copy into the repository's `.agents/skills/` rather than the user's home.** Would need no flag at all, since `--stack typescript` already writes into a target. Rejected because it puts the tool's own procedure inside the repositories it sets up, where it describes a run that already happened — the same reasoning that keeps `skills/agent-init-setup` out of `templates/`.

**Publish `install-local.mjs` and let it do both jobs.** Would ship one installer rather than two paths to one directory. Rejected because the hook chain it installs is a machine-wide change for a clone owner, and shipping it widens what a published package may do to a machine for no gain the skill install does not already provide.

**Raise the README's word ceiling to fit the new paragraph.** The budget file is editable and the paragraph is small. Rejected because the ceiling is the mechanism that keeps the README short; condensing 30 words elsewhere cost an afternoon's care and no information, which is the trade the budget is for.

## Consequences

The tool can be published: `npm pack` now carries 70 files and 90 kB including the `LICENSE`, and `npx @beeard/agent-init@<version> --install-skill` bootstraps the durable procedure on a machine that has never seen the repository.

Nothing here publishes anything: the first publish was a deliberate act with an npm account behind it — `npm whoami` answered `ENEEDAUTH` until then — and the OTP npm requires for a `PUT` is not something this repository can perform. The scope is what made it publishable at all; without one, npm refuses `agent-init` outright and no account changes that.

Two implementations of a link still exist and this records why: `install-local.mjs` relinks a stale symlink without a backup, because a link holds a path rather than content, and the CLI's `copyPath` backs up a real directory. They share the path arithmetic and the outcome vocabulary, so they cannot disagree about where the skill goes.

The published README now states the npm path, so its install section carries two routes where it carried one. The section was rewritten to say which route each situation takes rather than adding the npm block beside the clone example, and it came out shorter than it was — but the skill's own lookup and the README's `ln -s` line still have to stay true for both routes. That is the same maintenance cost the setup-skill record already named, paid once more.

`--install-skill` is refused beside scaffold options rather than ignored, which is a new refusal in the CLI and the reason `parseCli` now inspects which options were actually given rather than which keys are present.

## Related

Why the skill lives outside the repositories it scaffolds is in [The package ships its own setup skill](../feature/2026-09-16-the-package-ships-its-own-setup-skill.md), and why a clone links rather than copies is in [Machine-local pieces are installed by link](../process/2026-09-16-machine-local-pieces-are-installed-by-link.md). What the skill installs alongside is in [Skills are linked where the agent reads them](../feature/2026-09-17-skills-are-linked-where-the-agent-reads-them.md).
