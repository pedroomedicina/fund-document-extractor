import { eq, isNull } from 'drizzle-orm';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha256 } from '../../src/corpus/fetch.js';
import type { DbHandle } from '../../src/db/client.js';
import { chunks, EMBEDDING_DIMENSIONS, llmCalls } from '../../src/db/schema.js';
import { indexPdf } from '../../src/ingest/indexDocument.js';
import {
  EmbeddingError,
  embeddingInput,
  embedPendingChunks,
  openAiEmbedder,
} from '../../src/retrieval/embeddings.js';
import { fakeEmbedder } from '../helpers/fakeEmbedder.js';
import { textPdf } from '../helpers/pdfFixtures.js';
import { freshTestDb } from '../helpers/testDb.js';

const vector = (x: number) => new Array(EMBEDDING_DIMENSIONS).fill(x);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, statusText: `status ${status}` });
}

describe('openAiEmbedder', () => {
  it('returns vectors in input order with token usage', async () => {
    let sent: { model: string; input: string[] } | undefined;
    const embedder = openAiEmbedder({
      apiKey: 'test-key',
      fetch: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        // The API may return items out of order; `index` says which input each is.
        return jsonResponse(200, {
          data: [
            { index: 1, embedding: vector(2) },
            { index: 0, embedding: vector(1) },
          ],
          usage: { prompt_tokens: 7 },
        });
      },
    });
    const result = await embedder.embed(['a', 'b']);
    expect(sent).toEqual({ model: 'text-embedding-3-small', input: ['a', 'b'] });
    expect(result.vectors.map((v) => v[0])).toEqual([1, 2]);
    expect(result.inputTokens).toBe(7);
  });

  it('retries rate limits and 5xx, then succeeds', async () => {
    const statuses = [429, 503];
    const waits: number[] = [];
    const embedder = openAiEmbedder({
      apiKey: 'k',
      sleep: async (ms) => {
        waits.push(ms);
      },
      fetch: async () => {
        const status = statuses.shift();
        return status
          ? jsonResponse(status, {})
          : jsonResponse(200, {
              data: [{ index: 0, embedding: vector(0) }],
              usage: { prompt_tokens: 1 },
            });
      },
    });
    await expect(embedder.embed(['x'])).resolves.toMatchObject({ inputTokens: 1 });
    expect(waits).toEqual([500, 1000]);
  });

  it('fails at once on a client error, without echoing the response body', async () => {
    let calls = 0;
    const embedder = openAiEmbedder({
      apiKey: 'k',
      fetch: async () => {
        calls++;
        return jsonResponse(400, { error: { message: 'secret passage text' } });
      },
    });
    const error = await embedder.embed(['x']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmbeddingError);
    expect(String(error)).not.toMatch(/secret/);
    expect(calls).toBe(1);
  });

  it('gives up after maxAttempts', async () => {
    const embedder = openAiEmbedder({
      apiKey: 'k',
      maxAttempts: 2,
      sleep: async () => {},
      fetch: async () => jsonResponse(500, {}),
    });
    await expect(embedder.embed(['x'])).rejects.toThrow(/500/);
  });
});

describe('embedPendingChunks', () => {
  const PAGES = [
    'ARTICLE VIII\nFEES AND EXPENSES\nSection 8.1 Management Fee. The Partnership shall pay a management fee equal to two percent of Commitments.',
    'ARTICLE IX\nALLOCATIONS\nSection 9.1 Carried Interest. Twenty percent of Net Profits shall be allocated to the General Partner.',
  ];
  const options = { filename: 'lpa.pdf', ocr: null, chunking: { minTokens: 5, maxTokens: 40 } };

  let browser: Browser;
  let handle: DbHandle;
  let pdf: Uint8Array;
  beforeAll(async () => {
    browser = await chromium.launch();
    pdf = await textPdf(browser, PAGES);
  }, 30_000);
  afterAll(async () => {
    await handle?.close();
    await browser?.close();
  });
  beforeEach(async () => {
    await handle?.close();
    handle = await freshTestDb();
  });

  it('embeds every chunk once and records each batch in llm_calls', async () => {
    const { insertedChunks } = await indexPdf(handle.db, pdf, options);
    const embedder = fakeEmbedder();

    const report = await embedPendingChunks(handle.db, embedder, { batchSize: 1 });
    expect(report.chunks).toBe(insertedChunks);
    expect(embedder.calls).toHaveLength(insertedChunks);
    expect(await handle.db.$count(chunks, isNull(chunks.embedding))).toBe(0);

    const calls = await handle.db.select().from(llmCalls);
    expect(calls).toHaveLength(insertedChunks);
    expect(calls[0]).toMatchObject({
      purpose: 'embedding',
      model: 'fake-embedding',
      documentId: sha256(pdf),
      outputTokens: 0,
      outcome: 'ok',
    });
    expect(calls.reduce((n, c) => n + c.inputTokens, 0)).toBe(report.inputTokens);

    // Nothing pending: a second run makes no calls.
    expect((await embedPendingChunks(handle.db, embedder)).chunks).toBe(0);
    expect(embedder.calls).toHaveLength(insertedChunks);
  }, 30_000);

  it('embeds the section title with the text', async () => {
    await indexPdf(handle.db, pdf, options);
    const embedder = fakeEmbedder();
    await embedPendingChunks(handle.db, embedder);
    const [row] = await handle.db.select().from(chunks).where(eq(chunks.chunkIndex, 0));
    expect(embedder.calls.flat()).toContain(embeddingInput(row as NonNullable<typeof row>));
    expect(embedder.calls.flat().some((t) => t.startsWith('ARTICLE'))).toBe(true);
  }, 30_000);

  it('re-embeds a document after it is re-indexed', async () => {
    await indexPdf(handle.db, pdf, options);
    await embedPendingChunks(handle.db, fakeEmbedder());
    const { insertedChunks } = await indexPdf(handle.db, pdf, options);
    expect(await handle.db.$count(chunks, isNull(chunks.embedding))).toBe(insertedChunks);
    expect((await embedPendingChunks(handle.db, fakeEmbedder())).chunks).toBe(insertedChunks);
  }, 30_000);

  it('rejects vectors of the wrong size and stores nothing', async () => {
    await indexPdf(handle.db, pdf, options);
    const bad = {
      model: 'bad',
      usdPerMillionTokens: 0,
      embed: async (texts: readonly string[]) => ({
        vectors: texts.map(() => [1, 2, 3]),
        inputTokens: 1,
      }),
    };
    await expect(embedPendingChunks(handle.db, bad)).rejects.toThrow(/dimensions/);
    expect(await handle.db.$count(llmCalls)).toBe(0);
    expect(await handle.db.$count(chunks, isNull(chunks.embedding))).toBeGreaterThan(0);
  }, 30_000);
});
