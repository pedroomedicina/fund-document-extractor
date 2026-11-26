-- pgvector must exist before any table uses the vector type. drizzle-kit does not emit
-- extensions, so this custom migration runs first.
CREATE EXTENSION IF NOT EXISTS vector;
