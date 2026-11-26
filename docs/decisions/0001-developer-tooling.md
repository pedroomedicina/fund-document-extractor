# Use Biome, Vitest and TypeScript 7 for developer tooling

Status: accepted
Date: 25 November 2026

## Context

The repo had no linter, no formatter, no tests and no CI. Phase 0 adds all four. The constraints: one small service plus a React review screen later, ESM throughout, CI that runs in a couple of minutes, and a config a reviewer can read in under a minute.

## Decision

- **Lint and format:** Biome 2, using the `recommended` rule preset, with single quotes, trailing commas, 2-space indent and 100-column lines. CI runs `biome ci .`, which fails on lint errors or unformatted files.
- **Tests:** Vitest, with supertest for HTTP routes. `npm run test:ci` writes a JSON report, and `scripts/assert-no-skipped.mjs` fails the run if any test was skipped or left as todo, or if no tests ran.
- **Compiler:** TypeScript 7 (the native compiler) in `strict` mode with `noUncheckedIndexedAccess`, `module: NodeNext`, and `tsc --noEmit` as a separate CI step.

## Alternatives considered

- **ESLint + Prettier:** the most common pairing and the most configurable, with rules such as `typescript-eslint`'s type-aware checks that Biome does not have. It lost because it needs two tools, a dozen packages and two config files that have to agree on formatting. Biome's recommended rules cover what this codebase needs today. If type-aware lint rules become necessary (for example `no-floating-promises` once Effect code is common), adding `typescript-eslint` for those rules only is the escape hatch.
- **Jest:** mature, but ESM support still needs experimental flags, and it needs a separate TypeScript transform. Vitest runs ESM TypeScript directly and has a Jest-compatible API and JSON report.
- **`node:test`:** no dependencies, but its mocking, reporters and watch mode are thinner, and there is no ready-made JSON report to check for skipped tests.
- **TypeScript 5.x:** fine, but 7 is the current major and typechecks the repo faster. If a library's types break under 7, pinning to the last 5.x is a one-line change.

## Consequences

- One `biome.json` covers lint, format and import sorting for TS, JSON and Markdown. Biome also reformats Markdown, so docs follow the same whitespace rules.
- The no-skipped rule means a test that needs Postgres must get Postgres in CI, not quietly skip. Local runs without Docker will fail those tests on purpose. That matches the Python repo, where the same rule caught a broken service container.
- `noUncheckedIndexedAccess` makes array and record indexing return `T | undefined`. It is noisier, but it catches the "page N doesn't exist" class of bug that matters when every fact cites a page.
