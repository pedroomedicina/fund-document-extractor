import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { EMBEDDING_DIMENSIONS } from '../db/schema.js';

/** Reciprocal rank fusion constant. 60 is the value from the original RRF paper. */
export const RRF_K = 60;

export interface HybridQuery {
  /** Keyword query, parsed with websearch_to_tsquery ("management fee" -carried). */
  text: string;
  /** Embedding of the query. Omit to search by keyword only. */
  embedding?: readonly number[];
  /** Limit the search to one document (extraction always works on one). */
  documentId?: string;
  /** Results returned. */
  k?: number;
  /** Candidates taken from each side before fusing. */
  candidates?: number;
}

export interface HybridHit {
  id: string;
  documentId: string;
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  sectionTitle: string;
  sectionRefs: string[];
  text: string;
  /** 1-based rank in each list, or null when the chunk wasn't a candidate there. */
  keywordRank: number | null;
  vectorRank: number | null;
  score: number;
}

/**
 * Hybrid retrieval in one query: full-text (ts_rank_cd over the generated tsvector) and
 * vector (cosine over pgvector), fused by reciprocal rank. RRF uses ranks, not scores, so
 * the two lists don't need comparable scales. Keyword search catches exact defined terms
 * ("Carried Interest", "Section 8.1"); vectors catch the same clause in other words.
 *
 * Ties are broken by chunk id, so the same query always returns the same order.
 */
export async function hybridSearch(db: Db, query: HybridQuery): Promise<HybridHit[]> {
  const k = query.k ?? 8;
  const candidates = query.candidates ?? 40;
  if (query.embedding && query.embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new RangeError(`query embedding must have ${EMBEDDING_DIMENSIONS} dimensions`);
  }
  const docFilter = query.documentId ? sql`AND document_id = ${query.documentId}` : sql``;
  const vector = query.embedding ? JSON.stringify(query.embedding) : null;

  const vectorCte = vector
    ? sql`
      vec AS (
        SELECT id, row_number() OVER (ORDER BY distance, id) AS rank
        FROM (
          SELECT id, embedding <=> ${vector}::vector AS distance
          FROM chunks
          WHERE embedding IS NOT NULL ${docFilter}
          ORDER BY distance, id
          LIMIT ${candidates}
        ) nearest
      )`
    : sql`vec AS (SELECT NULL::text AS id, NULL::bigint AS rank WHERE false)`;

  const result = await db.execute<{
    id: string;
    document_id: string;
    chunk_index: number;
    page_start: number;
    page_end: number;
    section_title: string;
    section_refs: string[];
    text: string;
    keyword_rank: string | null;
    vector_rank: string | null;
    score: number;
  }>(sql`
    WITH
      q AS (SELECT websearch_to_tsquery('english', ${query.text}) AS query),
      kw AS (
        SELECT id, row_number() OVER (ORDER BY rank DESC, id) AS rank
        FROM (
          SELECT c.id, ts_rank_cd(c.tsv, q.query) AS rank
          FROM chunks c, q
          WHERE c.tsv @@ q.query ${docFilter}
          ORDER BY rank DESC, c.id
          LIMIT ${candidates}
        ) matches
      ),
      ${vectorCte},
      fused AS (
        SELECT id, kw.rank AS keyword_rank, vec.rank AS vector_rank,
          COALESCE(1.0 / (${RRF_K} + kw.rank), 0) + COALESCE(1.0 / (${RRF_K} + vec.rank), 0)
            AS score
        FROM kw FULL OUTER JOIN vec USING (id)
      )
    SELECT c.id, c.document_id, c.chunk_index, c.page_start, c.page_end, c.section_title,
      c.section_refs, c.text, f.keyword_rank, f.vector_rank, f.score::float8 AS score
    FROM fused f JOIN chunks c ON c.id = f.id
    ORDER BY f.score DESC, c.id
    LIMIT ${k}
  `);

  return result.rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    chunkIndex: r.chunk_index,
    pageStart: r.page_start,
    pageEnd: r.page_end,
    sectionTitle: r.section_title,
    sectionRefs: r.section_refs,
    text: r.text,
    keywordRank: r.keyword_rank === null ? null : Number(r.keyword_rank),
    vectorRank: r.vector_rank === null ? null : Number(r.vector_rank),
    score: Number(r.score),
  }));
}
