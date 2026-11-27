import { EMBEDDING_DIMENSIONS } from '../../src/db/schema.js';
import type { Embedder } from '../../src/retrieval/embeddings.js';

const words = (text: string) => text.toLowerCase().match(/[a-z]+/g) ?? [];

function bucket(word: string): number {
  let h = 2166136261;
  for (const ch of word) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % EMBEDDING_DIMENSIONS;
}

/** Bag-of-words vector, L2-normalised: texts sharing words are close. Deterministic. */
export function fakeVector(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const w of words(text)) v[bucket(w)] = (v[bucket(w)] ?? 0) + 1;
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

/** An Embedder that never calls the network, and records what it was asked. */
export function fakeEmbedder(): Embedder & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    model: 'fake-embedding',
    usdPerMillionTokens: 1,
    calls,
    async embed(texts) {
      calls.push([...texts]);
      return {
        vectors: texts.map(fakeVector),
        inputTokens: texts.reduce((n, t) => n + words(t).length, 0),
      };
    },
  };
}
