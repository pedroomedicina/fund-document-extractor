import { eq, sql } from 'drizzle-orm';
import type { Chunk } from '../chunking/chunker.js';
import type { IngestResult } from '../ingest/pdf.js';
import type { Db } from './client.js';
import { chunks, documents, pages } from './schema.js';

export interface StoredDocumentInput {
  /** sha256 of the file bytes. */
  id: string;
  filename: string;
  sourceId?: string | null;
  ingest: IngestResult;
  /** Printed page labels by page number, when known. */
  printedLabels?: ReadonlyMap<number, string>;
  chunks: readonly Chunk[];
}

export interface StoreReport {
  documentId: string;
  pages: number;
  deletedChunks: number;
  insertedChunks: number;
}

export const chunkId = (documentId: string, index: number) => `${documentId}:${index}`;

/**
 * Store a document, its pages and its chunks, replacing whatever was stored for it before.
 *
 * Port of the Python `replace_chunks` fix (status item C2): upserting alone left stale
 * chunks retrievable after re-chunking. Pages and chunks are deleted and re-inserted in one
 * transaction, so a reader never sees a document half-replaced. Embeddings are dropped
 * with the old chunks and must be recomputed.
 */
export async function storeDocument(db: Db, input: StoredDocumentInput): Promise<StoreReport> {
  const { ingest } = input;
  const row = {
    filename: input.filename,
    sourceId: input.sourceId ?? null,
    status: ingest.status,
    reviewReason: ingest.reviewReason,
    extractionMethod: ingest.method,
    extractionTrace: ingest.trace,
    textQuality: ingest.quality.label,
    textQualityScore: ingest.quality.score,
    textCoverage: ingest.coverage,
    pageCount: ingest.pages.length,
  };

  return db.transaction(async (tx) => {
    await tx
      .insert(documents)
      .values({ id: input.id, ...row })
      .onConflictDoUpdate({ target: documents.id, set: { ...row, updatedAt: sql`now()` } });

    await tx.delete(pages).where(eq(pages.documentId, input.id));
    if (ingest.pages.length > 0) {
      await tx.insert(pages).values(
        ingest.pages.map((page) => ({
          documentId: input.id,
          pageNumber: page.pageNumber,
          printedLabel: input.printedLabels?.get(page.pageNumber) ?? null,
          source: page.source,
          text: page.text,
        })),
      );
    }

    const deleted = await tx
      .delete(chunks)
      .where(eq(chunks.documentId, input.id))
      .returning({ id: chunks.id });
    if (input.chunks.length > 0) {
      await tx.insert(chunks).values(
        input.chunks.map((chunk) => ({
          id: chunkId(input.id, chunk.index),
          documentId: input.id,
          chunkIndex: chunk.index,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          sectionTitle: chunk.sectionTitle,
          sectionRefs: chunk.sectionRefs,
          tokenEstimate: chunk.tokenEstimate,
          text: chunk.text,
        })),
      );
    }

    return {
      documentId: input.id,
      pages: ingest.pages.length,
      deletedChunks: deleted.length,
      insertedChunks: input.chunks.length,
    };
  });
}
