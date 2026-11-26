# Phase 0 walkthrough: cleanup

**Goal:** turn a weekend RAG demo into a repo someone can review: nothing generated or secret in git, dependencies that are actually used, config that fails fast, errors with the right status codes, and CI that can't pass by accident.

**Commits** (on `main`, merged in PR #1): `ed42236` → `c924505` → `9c9095e` → `5bab5fd`. Reading those four diffs in order is the quickest way to retell this phase.

---

## 1. Repo hygiene

**What it does.** `dist/` is no longer tracked; `dist/`, `uploads/` and `.env*` (except `env.example`) are ignored. Sample text files moved to `test/fixtures/`.

**Why.** Committed build output goes stale and makes diffs noisy. Uploads are user data. `.env` holds keys.

**Likely questions**

- _"Why `git rm --cached` instead of deleting `dist/`?"_ It removes the files from git but keeps them on disk; the build recreates them anyway.

---

## 2. Dependencies and ESM

**What it does.** Removed `chromadb`, `pinecone-client`, `@chroma-core/default-embed` and `ai`, which were installed but never used. Type packages and the compiler moved to `devDependencies`. `ts-node` was replaced by `tsx`. The package is ESM (`"type": "module"`, `module: NodeNext`), which is why local imports end in `.js` even in `.ts` files.

**How it fails.** `pdf-parse`'s `index.js` runs a self-test that crashes under ESM. The legacy upload path imports `pdf-parse/lib/pdf-parse.js` directly to avoid it ([documentProcessor.ts:4](../../src/services/documentProcessor.ts:4)). Phase 1 replaced pdf-parse for the new pipeline (decision 0003).

**Likely questions**

- _"Why do imports say `.js` when the file is `.ts`?"_ Under NodeNext, TypeScript doesn't rewrite import paths; it checks that the path will be right at runtime, and at runtime the file is `.js`.
- _"Why remove dependencies that weren't hurting anything?"_ Each one is install time, attack surface and a reviewer asking "what's this for?". Unused vector-store clients also suggested an architecture the code didn't have.

---

## 3. Config that fails fast

**What it does.** [config.ts:35](../../src/config.ts:35) `loadConfig()` reads the environment once at startup and returns a typed `AppConfig`. `LLM_MODEL` is required; numbers and booleans are parsed strictly.

**How it works.** `parsePositiveInt` and `parseBool` ([config.ts:17](../../src/config.ts:17), [:26](../../src/config.ts:26)) return the fallback only when the variable is unset or empty, and throw `ConfigError` for anything malformed. `loadConfig` takes `env` as a parameter so tests pass a plain object instead of mutating `process.env`.

**Why.** The old code read `process.env` inside the request handler and hard-coded `gpt-3.5-turbo`. A missing or mistyped setting only showed up on the first request, in production. `MAX_FILE_SIZE=10mb` would have silently become `NaN`.

**How it fails.** Startup throws with the variable name and the bad value. Tested in [config.test.ts](../../test/config.test.ts), including a test that `env.example` parses and has no inline comments (a `# comment` after a value ends up inside the value).

**What I'd change.** Decode with an Effect Schema like the corpus manifest does, so config and the rest of the typed boundaries use one tool.

**Likely questions**

- _"Why not validate lazily?"_ Fail at deploy, not at 2 a.m. on the first request.
- _"Why does `ALLOW_UPLOADS` exist?"_ The public demo serves a preloaded corpus. Uploads would let anyone spend the OpenAI budget and store arbitrary files.

---

## 4. App factory and error handling

**What it does.** [app.ts:9](../../src/app.ts:9) `createApp(config)` builds the Express app; [server.ts](../../src/server.ts) only loads config and listens. The error handler ([app.ts:30](../../src/app.ts:30)) maps upload errors to 400 and everything else to a generic 500.

**How it works.**

- Splitting `createApp` from `listen` lets supertest drive the app in-process without opening a port.
- The upload dir is created at startup ([app.ts:11](../../src/app.ts:11)), so the first upload doesn't fail on a missing folder.
- The old `/uploads` static route is gone: uploaded files were publicly downloadable by URL.
- `MulterError` (e.g. `LIMIT_FILE_SIZE`) and `UnsupportedFileTypeError` ([upload.ts:12](../../src/routes/upload.ts:12)) become 400 with a `code`. Unknown errors are logged and return a message that leaks nothing.
- With uploads disabled, the route returns 403 **before** multer reads the body ([upload.ts:46](../../src/routes/upload.ts:46)), so a disabled deployment never writes the file to disk.
- The per-chunk similarity log in the vector store was removed (it logged on every query).

**How it fails / tests.** [app.test.ts](../../test/app.test.ts): health check, no public `/uploads`, 400 for wrong type, oversize and missing file, 403 when disabled.

**What I'd change.** `/api/upload` and `/api/qa` still run the **old** pipeline (pdf-parse, LangChain splitter, in-memory vector store). They're replaced in Phase 1e/2. Be upfront about this if asked to demo upload.

**Likely questions**

- _"Why 400 and not 413 for a too-large file?"_ 413 is arguably more correct. 400 with a specific `code` was the simpler consistent rule; switching is a one-line change.
- _"Express 5 — anything different?"_ Async handlers that reject are passed to the error middleware automatically; in Express 4 you had to call `next(err)` yourself.

---

## 5. CI and tooling

**What it does.** [.github/workflows/ci.yml](../../.github/workflows/ci.yml) runs, in order: install, Chromium, `biome ci`, `tsc --noEmit`, build, a migration drift check, a pgvector check, then tests. Decision: [0001](../decisions/0001-developer-tooling.md).

**How it works — three non-obvious steps:**

1. **Migration drift** ([ci.yml:62](../../.github/workflows/ci.yml:62)): regenerates migrations from `schema.ts`; if anything new appears in `drizzle/`, someone changed the schema without committing a migration.
2. **pgvector check** ([ci.yml:73](../../.github/workflows/ci.yml:73)): fails early with a clear message if the service container is broken, instead of 20 confusing test failures.
3. **No skipped tests** ([assert-no-skipped.mjs](../../scripts/assert-no-skipped.mjs)): reads Vitest's JSON report and fails if any test was skipped, left as todo, or if zero tests ran. A DB test that quietly skips when Postgres is missing would otherwise make CI green while testing nothing. Ported from the Python repo, where it caught exactly that.

Also: `strict` + `noUncheckedIndexedAccess`, so `pages[i]` is `Page | undefined`. Noisier, but "page N doesn't exist" is the bug class that matters when every fact cites a page.

**Why Biome / Vitest / TS 7.** One tool for lint and format instead of ESLint + Prettier; Vitest runs ESM TypeScript without a transform, unlike Jest. Alternatives and their trade-offs are in the decision record — know the ESLint escape hatch (`typescript-eslint` for type-aware rules like `no-floating-promises`).

**Likely questions**

- _"What does CI not catch?"_ Real corpus behaviour: CI uses synthetic fixtures, not the EDGAR LPAs. LLM quality: that's the Phase 3 eval.
- _"How long does CI take, and what's the slowest step?"_ Check a recent run before the interview; Chromium install is the likely answer.

---

## 6. Decision records

**What it does.** [docs/decisions/](../decisions/README.md): one numbered file per choice someone could ask "why this and not X?" about, written in the same commit as the code, never renumbered, superseded rather than edited.

**Why.** It's the interview prep built into the repo: each record is the answer to "why did you choose…?", with the alternatives you actually rejected.

**Likely questions**

- _"Isn't this overkill for a demo?"_ Each record is ~30 lines and written once. It's the habit, not the volume, that matters on a team.

---

## Explain-back checklist

You're ready when you can answer these without opening the code:

1. What happens at startup if `LLM_MODEL` is missing? If `MAX_FILE_SIZE=10mb`?
2. Why is `createApp` separate from `listen`?
3. A user uploads a 20 MB `.docx` with uploads enabled. Walk through what happens and what they get back.
4. Same request with `ALLOW_UPLOADS=false`. Why does the order of middleware matter?
5. Name the three CI steps that exist to stop CI from passing by accident.
6. Which parts of the running app are still the old pipeline?
