import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

/** OpenAI text-embedding-3-small. Changing models means a new column and a re-embed. */
export const EMBEDDING_DIMENSIONS = 1536;

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * One row per distinct file. The id is the sha256 of the file's bytes, so the same file
 * always gets the same id, and adding other files never changes it (Python status item C1).
 */
export const documents = pgTable(
  'documents',
  {
    id: text('id').primaryKey(),
    filename: text('filename').notNull(),
    /** corpus/sources.json id, for documents from the public corpus. */
    sourceId: text('source_id').unique(),
    status: text('status', { enum: ['ready', 'needs_review', 'failed'] }).notNull(),
    reviewReason: text('review_reason'),
    /** Set by classification (Phase 2). */
    docType: text('doc_type'),
    extractionMethod: text('extraction_method').notNull(),
    extractionTrace: jsonb('extraction_trace').$type<string[]>().notNull(),
    textQuality: text('text_quality', {
      enum: ['good', 'usable_with_caution', 'poor', 'failed'],
    }).notNull(),
    textQualityScore: real('text_quality_score').notNull(),
    textCoverage: real('text_coverage').notNull(),
    pageCount: integer('page_count').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('documents_id_is_sha256', sql`${t.id} ~ '^[0-9a-f]{64}$'`)],
);

/** Page text as extracted. Citations are validated against this, never against chunks. */
export const pages = pgTable(
  'pages',
  {
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    pageNumber: integer('page_number').notNull(),
    /** The number printed on the page ("12", "iv", "A-3"), when one was found. */
    printedLabel: text('printed_label'),
    source: text('source', { enum: ['text_layer', 'ocr'] }).notNull(),
    text: text('text').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.pageNumber] }),
    check('pages_page_number_positive', sql`${t.pageNumber} >= 1`),
  ],
);

export const chunks = pgTable(
  'chunks',
  {
    /** `${documentId}:${chunkIndex}`: stable for the same file and chunker settings. */
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    pageStart: integer('page_start').notNull(),
    pageEnd: integer('page_end').notNull(),
    sectionTitle: text('section_title').notNull(),
    sectionRefs: text('section_refs').array().notNull(),
    tokenEstimate: integer('token_estimate').notNull(),
    text: text('text').notNull(),
    /** Full-text index for the keyword half of hybrid retrieval. */
    tsv: tsvector('tsv').notNull().generatedAlwaysAs(sql`to_tsvector('english', text)`),
    /** Null until the embedding step runs (ingestion works without an API key). */
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
  },
  (t) => [
    unique('chunks_document_index').on(t.documentId, t.chunkIndex),
    check('chunks_page_range', sql`${t.pageStart} >= 1 AND ${t.pageStart} <= ${t.pageEnd}`),
    index('chunks_tsv_idx').using('gin', t.tsv),
    index('chunks_section_refs_idx').using('gin', t.sectionRefs),
    index('chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

/** A document split out of a combined PDF packet (Phase 2 segmentation). */
export const segments = pgTable(
  'segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    pageStart: integer('page_start').notNull(),
    pageEnd: integer('page_end').notNull(),
    docType: text('doc_type').notNull(),
    confidence: real('confidence').notNull(),
    method: text('method').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('segments_page_range', sql`${t.pageStart} >= 1 AND ${t.pageStart} <= ${t.pageEnd}`),
  ],
);

/** One extracted field from one extraction run. Never updated; reviews refer to it. */
export const extractions = pgTable(
  'extractions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').notNull(),
    field: text('field').notNull(),
    status: text('status', {
      enum: ['found', 'uncertain', 'not_found', 'placeholder', 'needs_review'],
    }).notNull(),
    value: jsonb('value'),
    pageStart: integer('page_start'),
    pageEnd: integer('page_end'),
    quote: text('quote'),
    confidence: real('confidence'),
    /** Validation errors from the last attempt, when the field ended in needs_review. */
    validationErrors: jsonb('validation_errors').$type<string[]>(),
    model: text('model').notNull(),
    promptSha256: text('prompt_sha256').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('extractions_run_field').on(t.runId, t.field),
    index('extractions_document_idx').on(t.documentId),
  ],
);

/** A reviewer's decision on one extraction. The extraction itself is never overwritten. */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    extractionId: uuid('extraction_id')
      .notNull()
      .references(() => extractions.id, { onDelete: 'cascade' }),
    action: text('action', { enum: ['approve', 'correct'] }).notNull(),
    correctedValue: jsonb('corrected_value'),
    correctedPage: integer('corrected_page'),
    correctedQuote: text('corrected_quote'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'reviews_correction_has_value',
      sql`${t.action} = 'approve' OR ${t.correctedValue} IS NOT NULL`,
    ),
  ],
);

/** Every LLM call, for the cost/latency report and the monthly budget check. */
export const llmCalls = pgTable(
  'llm_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purpose: text('purpose').notNull(),
    model: text('model').notNull(),
    documentId: text('document_id').references(() => documents.id, { onDelete: 'set null' }),
    promptSha256: text('prompt_sha256').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull(),
    latencyMs: integer('latency_ms').notNull(),
    outcome: text('outcome', { enum: ['ok', 'error', 'replayed'] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('llm_calls_created_at_idx').on(t.createdAt)],
);
