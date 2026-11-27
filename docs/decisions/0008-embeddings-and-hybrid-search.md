# Embed chunks with text-embedding-3-small and fuse keyword and vector search by rank

Status: accepted
Date: 26 November 2026

## Context

Phase 2 finds the clause for each field before calling the model, so only that context is sent. LPA clauses are found by exact defined terms ("Management Fee", "Carried Interest", "Section 8.1") and also by meaning, when a document uses its own words: NB Crossroads has no "incentive allocation", only a 93/7 waterfall in Section 8.2. The schema already has a `tsvector` column and a `vector(1536)` column (0005). This decision covers how they're filled and combined.

## Decision

- **Embeddings:** OpenAI `text-embedding-3-small` (1536 dimensions, $0.02 per million tokens), called with plain `fetch` in [embeddings.ts](../../src/retrieval/embeddings.ts) behind an `Embedder` interface, so tests use a deterministic fake. Each chunk is embedded as its section title plus its text. Batches of 64 are retried on 429 and 5xx with backoff, and each batch is written to `llm_calls` (purpose `embedding`), in the same transaction as the vectors. Errors never include the response body.
- **Hybrid search:** one SQL query in [hybrid.ts](../../src/retrieval/hybrid.ts) takes the top 40 chunks by `ts_rank_cd` over `websearch_to_tsquery('english', …)` and the top 40 by cosine distance. It fuses them with reciprocal rank fusion (`1 / (60 + rank)` summed across both lists) and breaks ties by chunk id, so results are deterministic. Without a query embedding it searches by keyword only.
- **Ingest:** `npm run corpus:ingest` stores pages and chunks for every pinned source, then embeds every chunk without an embedding. The whole corpus (381 chunks, 213k tokens) cost $0.0043.

## Alternatives considered

- **The `openai` SDK:** one endpoint doesn't need it. Phase 2's `Llm` service will choose its client separately.
- **Weighted score sum (α · cosine + (1 − α) · ts_rank):** the two scores have unrelated scales, and ts_rank depends on document length, so α would need tuning per corpus. RRF uses only ranks and has one constant with a published default.
- **Vector-only search:** misses exact terms. Defined terms and section numbers are how LPAs refer to themselves.
- **A larger embedding model (`text-embedding-3-large`, 3072 dimensions):** about 6.5 times the price and a schema change. Worth measuring once Phase 3 can show a retrieval miss that it would fix.
- **A reranker:** another model and another call per field. Same rule: add it only when the eval shows misses.

## Consequences

- Re-indexing drops a document's chunks, so every `corpus:ingest` run re-embeds everything it re-ingested. That costs under a cent for this corpus. At scale, reuse embeddings for chunks whose text hash didn't change.
- The vector side orders by distance with a document filter. pgvector can use the HNSW index here, but filtered HNSW scans may return fewer than 40 candidates on a large table. Fine at this size; at scale, use iterative scans or partition by document.
- The table of contents is a chunk like any other, so it ranks high for keyword queries: OCV's TOC chunk is the top keyword hit for "carried interest percentage". Phase 2 should flag TOC chunks at ingest and leave them out of retrieval.
- Keyword search uses the English stemmer. Defined terms in quotes still match, but so do their stems.
