import { createHash } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chunks, EMBEDDING_DIMENSIONS, llmCalls } from '../db/schema.js';

/** Turns texts into vectors. Injected so tests and CI never call the API. */
export interface Embedder {
  readonly model: string;
  /** USD per million input tokens, for the llm_calls ledger. */
  readonly usdPerMillionTokens: number;
  embed(texts: readonly string[]): Promise<{ vectors: number[][]; inputTokens: number }>;
}

export class EmbeddingError extends Error {
  override name = 'EmbeddingError';
}

export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
/** OpenAI list price for text-embedding-3-small. Check it when changing the model. */
export const OPENAI_EMBEDDING_USD_PER_MILLION = 0.02;

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export interface OpenAiEmbedderOptions {
  apiKey: string;
  fetch?: typeof fetch;
  model?: string;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * OpenAI /v1/embeddings over plain fetch: one endpoint doesn't justify the SDK. Retries
 * rate limits and 5xx with exponential backoff; any other error fails at once.
 */
export function openAiEmbedder(options: OpenAiEmbedderOptions): Embedder {
  const doFetch = options.fetch ?? fetch;
  const model = options.model ?? OPENAI_EMBEDDING_MODEL;
  const maxAttempts = options.maxAttempts ?? 4;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  return {
    model,
    usdPerMillionTokens: OPENAI_EMBEDDING_USD_PER_MILLION,
    async embed(texts) {
      for (let attempt = 1; ; attempt++) {
        const res = await doFetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model, input: texts }),
        });
        if (res.ok) {
          const body = (await res.json()) as {
            data: { index: number; embedding: number[] }[];
            usage: { prompt_tokens: number };
          };
          const vectors = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
          if (vectors.length !== texts.length) {
            throw new EmbeddingError(`asked for ${texts.length} embeddings, got ${vectors.length}`);
          }
          return { vectors, inputTokens: body.usage.prompt_tokens };
        }
        // Never echo the response body: it can repeat the request, and the request has text.
        if (!RETRYABLE.has(res.status) || attempt >= maxAttempts) {
          throw new EmbeddingError(`OpenAI embeddings returned ${res.status} ${res.statusText}`);
        }
        await sleep(500 * 2 ** (attempt - 1));
      }
    },
  };
}

/** What gets embedded for a chunk: its section title gives the passage its context. */
export const embeddingInput = (chunk: { sectionTitle: string; text: string }) =>
  chunk.sectionTitle ? `${chunk.sectionTitle}\n\n${chunk.text}` : chunk.text;

export interface EmbedReport {
  chunks: number;
  inputTokens: number;
  costUsd: number;
}

/**
 * Embed every chunk that has no embedding yet, in batches, and record each batch in
 * llm_calls. Re-running is cheap: chunks embedded before are skipped, and re-indexing a
 * document drops its chunks, so only changed documents are embedded again.
 */
export async function embedPendingChunks(
  db: Db,
  embedder: Embedder,
  options: { batchSize?: number; documentId?: string } = {},
): Promise<EmbedReport> {
  const batchSize = options.batchSize ?? 64;
  const report: EmbedReport = { chunks: 0, inputTokens: 0, costUsd: 0 };

  for (;;) {
    const batch = await db
      .select({
        id: chunks.id,
        documentId: chunks.documentId,
        sectionTitle: chunks.sectionTitle,
        text: chunks.text,
      })
      .from(chunks)
      .where(
        and(
          isNull(chunks.embedding),
          options.documentId ? eq(chunks.documentId, options.documentId) : undefined,
        ),
      )
      .orderBy(asc(chunks.id))
      .limit(batchSize);
    if (batch.length === 0) return report;

    const inputs = batch.map(embeddingInput);
    const started = Date.now();
    const { vectors, inputTokens } = await embedder.embed(inputs);
    const latencyMs = Date.now() - started;
    for (const v of vectors) {
      if (v.length !== EMBEDDING_DIMENSIONS) {
        throw new EmbeddingError(`expected ${EMBEDDING_DIMENSIONS} dimensions, got ${v.length}`);
      }
    }
    const costUsd = (inputTokens / 1_000_000) * embedder.usdPerMillionTokens;

    await db.transaction(async (tx) => {
      for (const [i, row] of batch.entries()) {
        await tx.update(chunks).set({ embedding: vectors[i] }).where(eq(chunks.id, row.id));
      }
      await tx.insert(llmCalls).values({
        purpose: 'embedding',
        model: embedder.model,
        documentId: batch.every((r) => r.documentId === batch[0]?.documentId)
          ? (batch[0]?.documentId ?? null)
          : null,
        promptSha256: createHash('sha256').update(JSON.stringify(inputs)).digest('hex'),
        inputTokens,
        outputTokens: 0,
        costUsd: costUsd.toFixed(6),
        latencyMs,
        outcome: 'ok',
      });
    });

    report.chunks += batch.length;
    report.inputTokens += inputTokens;
    report.costUsd += costUsd;
  }
}
