# Changelog

## [0.2.0]

- Four-band context window coloring relative to the auto-compaction trigger: muted below 30%, green (`success`) at 30–50%, yellow (`warning`) at 50–80%, red (`error`) at 80%+. Previously the low band shared the footer's muted `syntaxComment` color, so healthy usage blended into the surrounding text.

## [0.1.0]

- Initial release: always-on custom footer mirroring pi's default layout — token totals, cache hit %, cost with threshold colors, context window with auto-compact trigger coloring, cwd/branch/session, model and thinking level, and extension statuses. No toggle command; the footer is installed on every session start (including /new, /resume, /fork, /reload).
- Intentional divergence from `colored-footer.ts`: assistant branch entries without usage data are skipped instead of throwing (`src/stats.ts`). Real pi sessions always carry usage.
