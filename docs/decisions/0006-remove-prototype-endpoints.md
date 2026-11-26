# Remove the prototype upload and Q&A endpoints

Status: accepted
Date: 26 November 2026

## Context

`POST /api/upload` and `POST /api/qa` were left over from the original weekend RAG demo: pdf-parse for text, LangChain's `RecursiveCharacterTextSplitter` for chunks, and an in-memory vector array that was lost on every restart. The new pipeline doesn't use any of it. Real documents come in through `corpus:fetch` → `corpus:render` → `indexPdf`, and the planned public demo opens on a preloaded corpus with no upload.

Keeping the endpoints had costs:

- Uploads were on by default (`ALLOW_UPLOADS` defaulted to `true`).
- There is no login, so anyone who could reach the server could write files to disk and spend the OpenAI budget.
- `src/routes/upload.ts` caught its own errors and sent `error.message` back to the caller. The app-level error handler, which returns a message that leaks nothing, never saw those errors.
- Every line of it is code a reviewer can ask about, for a feature the product doesn't have.

## Decision

Delete both endpoints and everything only they used: the routes, `documentProcessor.ts`, `vectorStore.ts`, their types, the upload settings (`ALLOW_UPLOADS`, `MAX_FILE_SIZE`, `UPLOAD_DIR`), the multer error branches, and the dependencies `multer`, `uuid`, `pdf-parse`, `langchain`, `@langchain/core`, `@langchain/openai`, `openai` and their type packages. The HTTP API is `/health` only.

## Alternatives considered

- **Keep it, default it to off and fix the error leak:** makes it safe, but keeps ~460 lines and 52 production packages that run an architecture the product has replaced (no page citations, no persistence). It would still need explaining, and still need replacing.
- **Keep it behind auth:** auth is real work (users, sessions, rate limits) spent protecting a pipeline that's being thrown away. Auth belongs with the upload that replaces it.

## Consequences

- Nothing can be demoed over HTTP until Phase 2 adds the extraction endpoints. Until then the pipeline runs through the scripts and tests.
- `openai` comes back in Phase 2 for extraction and embeddings. LangChain is not expected to: the chunker and retrieval are our own.
- `LLM_MODEL` stays required at startup even though no code uses it until Phase 2, so a deployment's config doesn't change shape when the extractor lands.
- Uploads come back later, behind login and on the new pipeline (`ingestPdf` → `indexPdf`), with their own decision record.
- `src/` shrinks from about 1,806 to about 1,345 lines, and the lockfile from 165 to 113 production packages.
