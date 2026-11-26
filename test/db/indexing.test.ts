import { asc, cosineDistance, eq, sql } from 'drizzle-orm';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha256 } from '../../src/corpus/fetch.js';
import type { DbHandle } from '../../src/db/client.js';
import { chunks, documents, EMBEDDING_DIMENSIONS, pages } from '../../src/db/schema.js';
import { indexPdf } from '../../src/ingest/indexDocument.js';
import { blankPdf, textPdf } from '../helpers/pdfFixtures.js';
import { freshTestDb } from '../helpers/testDb.js';

const LPA_PAGES = [
  'ARTICLE I\nDEFINITIONS\n"Management Fee" has the meaning set forth in Section 8.1.\n1',
  'ARTICLE VIII\nFEES AND EXPENSES\nSection 8.1 Management Fee. The Partnership shall pay the Manager a management fee equal to two percent of aggregate Commitments.\n2',
  'Section 8.2 Offsets. Transaction fees shall reduce the Management Fee.\nARTICLE IX\nALLOCATIONS\nSection 9.1 Carried Interest. Twenty percent of Net Profits shall be allocated to the General Partner.\n3',
];
const options = {
  filename: 'example-lpa.pdf',
  ocr: null,
  chunking: { minTokens: 5, maxTokens: 60 },
};

let handle: DbHandle;
let browser: Browser;
let lpa: Uint8Array;

beforeAll(async () => {
  browser = await chromium.launch();
  lpa = await textPdf(browser, LPA_PAGES);
}, 30_000);
afterAll(async () => {
  await handle?.close();
  await browser?.close();
});
beforeEach(async () => {
  await handle?.close();
  handle = await freshTestDb();
});

const chunkRows = (documentId: string) =>
  handle.db
    .select()
    .from(chunks)
    .where(eq(chunks.documentId, documentId))
    .orderBy(asc(chunks.chunkIndex));

describe('migrations', () => {
  it('enable pgvector and create every table', async () => {
    const ext = await handle.db.execute(
      sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`,
    );
    expect(ext.rows).toHaveLength(1);
    const tables = await handle.db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      'chunks',
      'documents',
      'extractions',
      'llm_calls',
      'pages',
      'reviews',
      'segments',
    ]);
  });
});

describe('indexPdf', () => {
  it('stores the document under its content hash, with pages, labels and chunks', async () => {
    const report = await indexPdf(handle.db, lpa, options);
    expect(report).toMatchObject({ documentId: sha256(lpa), status: 'ready', pages: 3 });

    const [doc] = await handle.db
      .select()
      .from(documents)
      .where(eq(documents.id, sha256(lpa)));
    expect(doc).toMatchObject({ status: 'ready', extractionMethod: 'unpdf', pageCount: 3 });

    const storedPages = await handle.db.select().from(pages).orderBy(asc(pages.pageNumber));
    expect(storedPages.map((p) => p.printedLabel)).toEqual(['1', '2', '3']);

    const rows = await chunkRows(sha256(lpa));
    expect(rows.length).toBe(report.insertedChunks);
    const fee = rows.find((r) => r.sectionRefs.includes('8.1') && r.text.includes('two percent'));
    expect(fee).toMatchObject({ pageStart: 2, sectionTitle: 'ARTICLE VIII FEES AND EXPENSES' });
    expect(rows.every((r) => r.id === `${sha256(lpa)}:${r.chunkIndex}`)).toBe(true);
  }, 30_000);

  it('re-indexing replaces chunks instead of adding stale ones (Python status item C2)', async () => {
    const first = await indexPdf(handle.db, lpa, options);
    const again = await indexPdf(handle.db, lpa, options);
    expect(again.deletedChunks).toBe(first.insertedChunks);
    expect(await chunkRows(sha256(lpa))).toHaveLength(first.insertedChunks);

    // Re-chunking with different settings leaves only the new chunks.
    const rechunked = await indexPdf(handle.db, lpa, {
      ...options,
      chunking: { minTokens: 5, maxTokens: 15 },
    });
    expect(rechunked.insertedChunks).toBeGreaterThan(first.insertedChunks);
    expect(await chunkRows(sha256(lpa))).toHaveLength(rechunked.insertedChunks);
    expect(await handle.db.$count(documents)).toBe(1);
  }, 30_000);

  it('keeps pages but no chunks for a document sent to review', async () => {
    const blank = await blankPdf(browser);
    const report = await indexPdf(handle.db, blank, { ...options, filename: 'scan.pdf' });
    expect(report).toMatchObject({ status: 'needs_review', insertedChunks: 0 });
    const [doc] = await handle.db
      .select()
      .from(documents)
      .where(eq(documents.id, sha256(blank)));
    expect(doc?.reviewReason).toMatch(/no extractable text/);
    expect(await handle.db.$count(pages, eq(pages.documentId, sha256(blank)))).toBe(2);
  }, 30_000);
});

describe('retrieval columns', () => {
  it('fills the full-text column, so keyword search finds the fee clause', async () => {
    await indexPdf(handle.db, lpa, options);
    const hits = await handle.db
      .select({ refs: chunks.sectionRefs })
      .from(chunks)
      .where(sql`${chunks.tsv} @@ websearch_to_tsquery('english', 'management fee commitments')`);
    expect(hits.some((h) => h.refs.includes('8.1'))).toBe(true);
  }, 30_000);

  it('stores embeddings and orders by cosine distance', async () => {
    await indexPdf(handle.db, lpa, options);
    const rows = await chunkRows(sha256(lpa));
    const unit = (i: number) =>
      Array.from({ length: EMBEDDING_DIMENSIONS }, (_, j) => (j === i ? 1 : 0));
    for (const [i, row] of rows.entries()) {
      await handle.db
        .update(chunks)
        .set({ embedding: unit(i) })
        .where(eq(chunks.id, row.id));
    }
    const target = rows.length - 1;
    const [nearest] = await handle.db
      .select({ id: chunks.id })
      .from(chunks)
      .orderBy(cosineDistance(chunks.embedding, unit(target)))
      .limit(1);
    expect(nearest?.id).toBe(rows[target]?.id);
  }, 30_000);

  it('rejects a document id that is not a sha256', async () => {
    await expect(
      handle.db.insert(documents).values({
        id: 'doc-1',
        filename: 'x.pdf',
        status: 'ready',
        extractionMethod: 'unpdf',
        extractionTrace: [],
        textQuality: 'good',
        textQualityScore: 1,
        textCoverage: 1,
        pageCount: 1,
      }),
    ).rejects.toThrow();
  });
});
