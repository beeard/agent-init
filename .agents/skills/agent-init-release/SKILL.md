---
name: agent-init-release
description: Prepare and publish a new version of @beeard/agent-init to npm — choose the version, bump it, fix every pinned version reference, commit and tag, publish, verify the published package from the registry, and write the GitHub release notes. Use when the user asks to release, publish, prepare a publish, or bump the version of this package. Only for this repository; it is not shipped in the package and not scaffolded into other repositories.
---

# Release @beeard/agent-init

This skill is the procedure for publishing this package. It lives in this repository's `.agents/skills/`, which is neither in the `files` list of `package.json` nor under `templates/`, so no install and no scaffold carries it. Keep it that way: a release procedure written into a receiving repository would describe a package that repository does not publish.

`npm publish` runs `scripts/prepublish.mjs` as `prepublishOnly`. It refuses a publish from a tree with uncommitted shipped paths, from a `HEAD` without the `v<version>` tag, or where `npm test`, `npm run check`, or `npm run format:check` fails. The steps below are what gets a tree past it; do not work around a refusal.

## 1. Confirm the base

```sh
git fetch --prune
git status --short --branch
git log --oneline "v$(node -p 'require("./package.json").version')"..origin/master --no-merges
```

Release from `master`, up to date with `origin/master`, with no open pull request the user expects in this version. The log is what the release contains; show it to the user.

## 2. Choose the version

Compare against the last published version, not only the last tag:

```sh
npm view @beeard/agent-init version
```

Before 1.0.0, a new capability or a change to what the CLI writes or refuses raises the minor version; fixes alone raise the patch. State the chosen version and the reason, and let the user confirm it.

## 3. Bump and fix pinned references

```sh
npm version <x.y.z> --no-git-tag-version
grep -rn "<old-version>" --exclude-dir=.git --exclude-dir=node_modules .
```

Every hit outside `.agents/notes/` is a pinned reference and moves with the version. `docs/prompt-for-external-agents.md` names the tarball, and `npm pack` names it `beeard-agent-init-<x.y.z>.tgz` because of the scope. Decision records cite the version they were written against; leave them.

## 4. Run the checks

```sh
npm test
npm run check
npm run format:check
npm pack --dry-run
```

Report the counts, including skipped tests and why they skipped. Compare the file count from `npm pack --dry-run` with the published one from `npm view @beeard/agent-init dist.fileCount`, and explain the difference.

## 5. Commit, tag, and push

The version commit carries only the version and its pinned references:

```sh
git add package.json <pinned-reference files>
git commit -m "chore: <x.y.z>"
git tag v<x.y.z>
git push origin master v<x.y.z>
```

Pushing is outward-facing: ask the user before running it.

## 6. Publish

The user publishes; an agent cannot complete the login or the second factor. npm older than the current web login fails with `ENYI: Web login not supported`, and a command run through the agent's shell times out while the browser step waits. Give the user these lines to run in their own terminal:

```sh
npx npm@latest login
npx npm@latest publish --access public
```

## 7. Verify from the registry

After the user reports the publish, fetch the package back with an empty cache and home, so nothing local answers for it:

```sh
tmp=$(mktemp -d)
export npm_config_cache="$tmp/cache" HOME="$tmp/home"
mkdir -p "$HOME" "$tmp/repo" && git -C "$tmp/repo" init -q
npm view @beeard/agent-init@<x.y.z> version bin license repository
npx --yes @beeard/agent-init@<x.y.z> --install-skill
npx --yes @beeard/agent-init@<x.y.z> "$tmp/repo" --name Probe
(cd "$tmp/repo" && node scripts/gates/run.mjs)
```

The skill must land in `$HOME/.claude/skills/agent-init-setup/`, and the scaffolded repository's gates must pass. Report each result. A failure here is a published defect: say so, and fix it with a patch release rather than `npm unpublish`.

## 8. Publish the release notes

The repository is public, so its GitHub release is where a user upgrading from an earlier version reads what changed. Create it from the tag once the registry check passes:

```sh
gh release create v<x.y.z> --title v<x.y.z> --generate-notes --draft
```

The generated notes list pull requests, not what a user notices. Rewrite the draft as a few lines grouped by what changed for someone running the tool, and name anything a re-run now does differently or refuses. Show it to the user, and publish it with `gh release edit v<x.y.z> --draft=false` once they agree: it is public.
