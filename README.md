# pi-simple-footer

A [Pi](https://pi.dev) footer extension that replaces the built-in status bar
with the same layout, always on. It shows token totals (`↑`/`↓`), cache reads
and writes with the cache hit percentage, session cost colored by threshold,
context-window usage with the auto-compact trigger coloring, the working
directory, branch and session name, the active model and thinking level,
and the extension statuses (MCP, etc.) on a second line. There is no toggle:
the footer is installed on every session start, so it survives `/new`,
`/resume`, `/fork`, and `/reload`.

## Install

Add the package to the `packages` array in `~/.pi/agent/settings.json`:

```json
{
  "packages": ["git:github.com/junkfactory/pi-simple-footer"]
}
```

Then restart pi, or run `/reload`.

## What it shows

Line 1, left to right:

| Segment | Content |
| --- | --- |
| Location | `~`-shortened cwd, then `(<branch>)`, then `• <session name>` when set. Branch is the git branch, or in a jj repo the working copy's own bookmark, falling back to the most recent one on its ancestors when it has none, plus the working-copy change id, e.g. `(main·qlvu)`, with `!` when the working copy is conflicted. With no reachable bookmark the change id stands alone (`(qlvu)`); several bookmarks on one change are listed space-separated (`(main next·qlvu)`). The probe is asynchronous: a branch-change or repo-change event re-probes immediately, otherwise at most once per 30 s, and a failed probe keeps the last shown label. The slot is omitted when no branch resolves: a jj repo whose probe has not succeeded yet, or git at a detached HEAD (pi's `detached` label carries no information). |
| Tokens | `↑<input> ↓<output>`; `R<cacheRead>`/`W<cacheWrite>` only when non-zero |
| Cache hit | `CH<hit>%` — `cacheRead / (cacheRead + input)` |
| Context | `<percent>%/<window> ↻`; `?` when the percent is unknown, `↻` when auto-compact is enabled |
| Cost | `$<cost>` — `success` below $1, `warning` from $1, `error` from $5 |

Line 1, right side: `(provider)` dim, the model id in the warning color, and
`• <thinking level>` colored per level.

The context segment colors against the actual auto-compaction trigger
(`contextWindow - reserveTokens`, including per-model overrides): `warning` at
50% and `error` at 80% of that trigger.

Line 2 shows extension statuses joined with two spaces (dim); it is omitted
when nothing reports a status.

There is deliberately no `/footer` toggle or `enabled` setting — the footer
is installed unconditionally on every `session_start`.

## Development

```bash
npm install
npm run check   # tsc --noEmit
npm test        # node --test via jiti
```

This repo uses [jj](https://jj-vcs.github.io/jj/) (colocated with git). The jj
branch probe always runs `jj --ignore-working-copy`: without the flag jj snapshots
the working copy on every refresh, adding an operation to `jj op log` each time.
Commits follow conventional-commit prefixes (`feat:`, `fix:`, `docs:`,
`test:`, `chore:`, `refactor:`). Never push or release automatically.
