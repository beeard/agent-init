# Decision Record: Edits are checked and formatted as they are made

Status: implemented

## Problem

An agent working in this repository learned it had broken a file only when `npm test` or `npm run check` ran, often several edits later, and the layout of the JavaScript depended on who wrote it. Nothing stated a layout, so nothing could enforce one. Separately, every subagent inherited the main session's model and effort, so a file search or a well-specified edit ran at the cost and speed of the session's own deliberation.

## Decision

`.claude/settings.json` registers a `PostToolUse` hook on `Write`, `Edit`, and `MultiEdit` that runs `.claude/hooks/post-edit.mjs` on the file just edited. It runs `node --check` on `.mjs`, `.js`, and `.cjs`, `JSON.parse` on `.json`, and then Prettier on the JavaScript and on `.yml` and `.yaml`, which also rejects invalid YAML. Exit 2, with the reason on stderr, hands a broken file back to the agent; exit 1 reports a tooling problem, such as Prettier being unreachable offline, without blocking. Files outside the project, and every other extension, are left alone. `tests/claude-hooks.test.mjs` breaks each file type once and asserts the rejection, and asserts that a valid file is rewritten to the repository layout.

The layout is `.prettierrc.json`: no semicolons, single quotes, 160 columns, trailing commas, bare single arrow parameters. It is the style the code already had, chosen so the one-time reformat changed layout only. `.prettierignore` excludes JSON, because the scaffolder's merges and npm serialize it with `JSON.stringify(value, null, 2)` and Prettier would disagree with both, and Markdown, which has its own gates. Prettier is not a dependency: `npx` fetches the version pinned in `package.json` as `config.prettier`, which the hook, `npm run format`, and `npm run format:check` all read. CI runs `npm run format:check`, so the layout is enforced for every change, not only for changes an agent made.

`CLAUDE_CODE_SUBAGENT_MODEL` is `sonnet` in the project settings, and `.claude/agents/` overrides the built-in `Explore`, `general-purpose`, and `Plan` agents with `effort: low`, `Explore` on `haiku` and read-only. The main session keeps its own model and effort for the judgement; subagents search and carry out settled work.

## Alternatives considered

**Prettier as a devDependency.** The usual arrangement. Rejected because the package has no dependencies and no lockfile, and CI installs nothing for it; a pinned `npx` run keeps both true at the cost of a download on first use.

**Format JSON too.** One tool for every file. Rejected because the scaffolder rewrites merged manifests with `JSON.stringify`, so a receiving repository would get two layouts in one file set, and `npm` reformats `package.json` on every install.

**Run the relevant tests from the hook.** Catches more than a syntax error. Rejected because a test run takes tens of seconds, and a hook that slow after every edit is one an agent routes around; the full suites stay where AGENTS.md puts them.

**Disable thinking for subagents.** What was asked for. Not available: thinking follows the session, and a subagent's frontmatter can set only its model and effort. `effort: low` is the closest setting that exists.

## Consequences

A syntax error reaches the agent on the edit that made it, and the JavaScript has one layout, checked in CI. The first edit after a Prettier release that changes output will reformat more than the edit touched, until the pin is raised deliberately. The hook needs network access the first time it runs a given Prettier version, and says so rather than blocking when it has none. The overridden built-in agents carry this repository's own instructions instead of the defaults, so a change to Claude Code's built-in prompts does not reach them.
