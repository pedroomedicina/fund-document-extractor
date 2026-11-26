import { type ChunkOptions, chunkDocument, DEFAULT_CHUNK_OPTIONS } from '../chunking/chunker.js';
import { sha256 } from '../corpus/fetch.js';
import { detectPrintedLabel } from '../corpus/pageLabels.js';
import type { Db } from '../db/client.js';
import { type StoreReport, storeDocument } from '../db/documents.js';
import type { OcrEngine } from './ocr.js';
import { ingestPdf } from './pdf.js';

export interface IndexOptions {
  filename: string;
  sourceId?: string | null;
  ocr: OcrEngine | null;
  chunking?: ChunkOptions;
}

export interface IndexReport extends StoreReport {
  status: 'ready' | 'needs_review';
  method: string;
}

/**
 * PDF bytes -> pages -> chunks -> database. The document id is the sha256 of the bytes.
 *
 * Only documents whose text passed the quality gate are chunked (as in the Python chunker's
 * filter): a document sent to review keeps its pages for the reviewer but has no chunks,
 * so its text can't be retrieved or cited until someone looks at it.
 */
export async function indexPdf(
  db: Db,
  bytes: Uint8Array,
  options: IndexOptions,
): Promise<IndexReport> {
  const ingest = await ingestPdf(bytes, { ocr: options.ocr });
  const chunks =
    ingest.status === 'ready'
      ? chunkDocument(
          ingest.pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
          options.chunking ?? DEFAULT_CHUNK_OPTIONS,
        )
      : [];

  const printedLabels = new Map<number, string>();
  for (const page of ingest.pages) {
    const label = detectPrintedLabel(page.text);
    if (label) printedLabels.set(page.pageNumber, label);
  }

  const report = await storeDocument(db, {
    id: sha256(bytes),
    filename: options.filename,
    sourceId: options.sourceId ?? null,
    ingest,
    printedLabels,
    chunks,
  });
  return { ...report, status: ingest.status, method: ingest.method };
}
