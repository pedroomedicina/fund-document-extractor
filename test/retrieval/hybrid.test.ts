import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../../src/corpus/fetch.js';
import type { DbHandle } from '../../src/db/client.js';
import { indexPdf } from '../../src/ingest/indexDocument.js';
import { embedPendingChunks } from '../../src/retrieval/embeddings.js';
import { hybridSearch, RRF_K } from '../../src/retrieval/hybrid.js';
import { fakeEmbedder, fakeVector } from '../helpers/fakeEmbedder.js';
import { textPdf } from '../helpers/pdfFixtures.js';
import { freshTestDb } from '../helpers/testDb.js';

const LPA = [
  'ARTICLE VIII\nFEES AND EXPENSES\nSection 8.1 Management Fee. The Partnership shall pay the Manager a management fee equal to two percent of aggregate Commitments.',
  'Section 8.2 Organizational Expenses. The Partnership shall bear legal and accounting costs of its formation.',
  'ARTICLE IX\nALLOCATIONS\nSection 9.1 Carried Interest. Twenty percent of Net Profits shall be allocated to the General Partner after the Preferred Return.',
  'ARTICLE X\nKEY PERSONS\nSection 10.1 Key Person Event. If any Key Person ceases to devote substantially all business time, the Investment Period is suspended.',
];
const OTHER = [
  'ARTICLE I\nGENERAL\nSection 1.1 Management Fee. The other fund pays a management fee of one and one half percent.',
];
const options = { ocr: null, chunking: { minTokens: 5, maxTokens: 40 } };

let browser: Browser;
let handle: DbHandle;
let lpaId: string;
let otherId: string;

beforeAll(async () => {
  browser = await chromium.launch();
  handle = await freshTestDb();
  const lpa = await textPdf(browser, LPA);
  const other = await textPdf(browser, OTHER);
  lpaId = sha256(lpa);
  otherId = sha256(other);
  await indexPdf(handle.db, lpa, { ...options, filename: 'lpa.pdf' });
  await indexPdf(handle.db, other, { ...options, filename: 'other.pdf' });
  await embedPendingChunks(handle.db, fakeEmbedder());
}, 60_000);
afterAll(async () => {
  await handle?.close();
  await browser?.close();
});

describe('hybridSearch', () => {
  it('ranks the clause matched by both keyword and vector first', async () => {
    const text = 'management fee';
    const [top] = await hybridSearch(handle.db, {
      text,
      embedding: fakeVector(text),
      documentId: lpaId,
    });
    expect(top).toMatchObject({ documentId: lpaId, keywordRank: 1, vectorRank: 1 });
    expect(top?.sectionRefs).toContain('8.1');
    expect(top?.score).toBeCloseTo(2 / (RRF_K + 1));
  });

  it('stays inside the requested document', async () => {
    const text = 'management fee';
    const hits = await hybridSearch(handle.db, {
      text,
      embedding: fakeVector(text),
      documentId: lpaId,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.documentId === lpaId)).toBe(true);

    const all = await hybridSearch(handle.db, { text, embedding: fakeVector(text) });
    expect(all.some((h) => h.documentId === otherId)).toBe(true);
  });

  it('finds a clause by vector when the keywords do not match', async () => {
    // No chunk contains "remuneration", so the keyword list is empty; the vector side
    // still finds the fee clause from the words it shares.
    const hits = await hybridSearch(handle.db, {
      text: 'remuneration',
      embedding: fakeVector('fee paid to the manager on commitments'),
      documentId: lpaId,
    });
    expect(hits[0]).toMatchObject({ keywordRank: null, vectorRank: 1 });
    expect(hits[0]?.sectionRefs).toContain('8.1');
  });

  it('works by keyword alone when no embedding is given', async () => {
    const hits = await hybridSearch(handle.db, { text: '"key person"', documentId: lpaId });
    expect(hits[0]?.sectionRefs).toContain('10.1');
    expect(hits.every((h) => h.vectorRank === null)).toBe(true);
  });

  it('returns pages and section refs for citing, and the same order every time', async () => {
    const query = {
      text: 'carried interest net profits',
      embedding: fakeVector('carried interest'),
    };
    const first = await hybridSearch(handle.db, { ...query, k: 3 });
    const again = await hybridSearch(handle.db, { ...query, k: 3 });
    expect(first.map((h) => h.id)).toEqual(again.map((h) => h.id));
    expect(first).toHaveLength(3);
    const carry = first.find((h) => h.sectionRefs.includes('9.1'));
    expect(carry).toMatchObject({ pageStart: 3, pageEnd: 3 });
  });

  it('rejects a query embedding of the wrong size', async () => {
    await expect(hybridSearch(handle.db, { text: 'fee', embedding: [1, 2] })).rejects.toThrow(
      RangeError,
    );
  });
});
