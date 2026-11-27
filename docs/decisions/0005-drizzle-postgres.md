# Store documents in Postgres + pgvector through Drizzle

Status: accepted, amended by [0007](0007-fit-filed-pages-and-stable-corpus-ids.md)
Date: 25 November 2026

## Context

The in-memory vector array lost everything on restart and couldn't answer "which page is this on?". The job description names PostgreSQL. The data is relational: documents have pages, pages back chunks, extractions cite pages, reviews refer to extractions, LLM calls are costed per document. Retrieval needs both vectors and full-text search, and the Python project already ran hybrid retrieval on Postgres + pgvector.

The other choice is how TypeScript talks to Postgres: typed queries, and migrations a reviewer can read.

## Decision

- **Postgres 17 + pgvector** for everything: rows, a generated `tsvector` column (`to_tsvector('english', text)`, GIN index) for keyword search, and a `vector(1536)` column with an HNSW cosine index for semantic search. One database, one transaction for re-indexing.
- **Drizzle ORM + drizzle-kit:** the schema is TypeScript (`src/db/schema.ts`). `drizzle-kit generate` writes plain SQL migrations into `drizzle/`, which are committed and reviewed. CI regenerates and fails if `schema.ts` and the migrations differ. pgvector is enabled by a hand-written first migration, because drizzle-kit doesn't emit extensions.
- **Rules carried over from the Python project:** document ids are the sha256 of the file (status item C1). Re-indexing deletes a document's pages and chunks and re-inserts them in one transaction (C2). Chunk ids are `documentId:chunkIndex`. Constraints enforce sha256-shaped ids, valid page ranges, and that a "correct" review carries a value.
- `docker-compose.yml` runs the same `pgvector/pgvector:pg17` image CI uses, on host port 5433.

## Alternatives considered

- **Kysely:** an excellent typed query builder, closer to raw SQL. It has no schema-to-migration generator (migrations are written by hand in TypeScript) and no built-in pgvector types. Drizzle gives both, and its SQL output is reviewable.
- **Prisma:** mature, with good migrations, but pgvector is an `Unsupported` type: vector queries drop to raw SQL, and generated columns need manual migration edits. It also adds a generation step and its own engine.
- **Raw `pg` with SQL files:** no abstraction to learn, but no type link between queries and schema, which is the point of a typed codebase.
- **A dedicated vector store (Pinecone, Chroma, Qdrant):** the old code depended on two of these without using them. Separate storage splits one re-index into two systems with no shared transaction, so stale vectors come back (the exact C2 bug). pgvector with HNSW is plenty at this corpus size.
- **Effect SQL (`@effect/sql-pg`):** fits the Effect pipeline, but its Effect 4 version is new, and Drizzle's migration tooling is more mature. The Effect pipeline (Phase 2) wraps repository calls in Effects at its boundary.

## Consequences

- Embedding dimension 1536 (OpenAI `text-embedding-3-small`) is fixed in the schema. Changing models means a migration and a re-embed, recorded as its own decision.
- `embedding` is nullable: ingestion and keyword search work without an API key, and embedding is a separate, costed step.
- Re-indexing drops a document's embeddings with its chunks. That's correct (the text may have changed) but costs a re-embed.
- Integration tests rebuild the `_test` database from the migrations before each test, so a migration that doesn't apply cleanly fails CI. They refuse to run against a database whose name doesn't end in `_test`. While there is only one DB test file this is safe under Vitest's parallel files; a second file will need its own database or serial execution. (Since 26 November 2026 there are three, and `vitest.config.ts` runs test files serially.)
