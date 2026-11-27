/**
 * Ingest the corpus into DATABASE_URL: pages, chunks and (unless --no-embed) embeddings.
 *
 *   npm run corpus:ingest                  every source with a pinned hash
 *   npm run corpus:ingest -- --only a,b    limit to these source ids
 *   npm run corpus:ingest -- --no-embed    skip the OpenAI embedding step
 *
 * Reads corpus/raw/*.pdf and corpus/rendered/*.pdf (run corpus:fetch and corpus:render
 * first). Refuses a file whose hash or pagination fingerprint differs from the manifest,
 * because gold labels and citations would point at the wrong pages.
 * Embedding needs OPENAI_API_KEY; it costs about $0.02 per million tokens.
 */
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { sha256 } from '../src/corpus/fetch.js';
import { readManifest, type Source } from '../src/corpus/manifest.js';
import { pagesFingerprint } from '../src/corpus/pageLabels.js';
import { pdfPageTexts } from '../src/corpus/render.js';
import { connect } from '../src/db/client.js';
import { indexPdf } from '../src/ingest/indexDocument.js';
import { createTesseractOcr, type OcrEngine } from '../src/ingest/ocr.js';
import { embedPendingChunks, openAiEmbedder } from '../src/retrieval/embeddings.js';

const MANIFEST = 'corpus/sources.json';

const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    'no-embed': { type: 'boolean', default: false },
  },
});
const only = values.only ? new Set(values.only.split(',').map((id) => id.trim())) : null;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set (see env.example)');
  process.exit(1);
}
const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!values['no-embed'] && !apiKey) {
  console.error('OPENAI_API_KEY is not set; set it or pass --no-embed');
  process.exit(1);
}

/** Tesseract starts only if some document needs OCR: loading it downloads language data. */
function lazyOcr(): OcrEngine & { started: boolean } {
  let engine: Promise<OcrEngine> | null = null;
  return {
    name: 'tesseract',
    get started() {
      return engine !== null;
    },
    async recognize(png) {
      engine ??= createTesseractOcr();
      return (await engine).recognize(png);
    },
    async close() {
      if (engine) await (await engine).close();
    },
  };
}

/** The PDF to ingest for a source, checked against the manifest. */
async function pinnedPdf(source: Source): Promise<{ bytes: Uint8Array; file: string }> {
  if (!source.sha256) throw new Error('no pinned sha256; run corpus:fetch -- --record');
  if (source.kind === 'pdf') {
    const file = path.join('corpus/raw', `${source.id}.pdf`);
    if (!existsSync(file)) throw new Error(`${file} missing; run corpus:fetch`);
    const bytes = new Uint8Array(readFileSync(file));
    if (sha256(bytes) !== source.sha256) throw new Error(`${file} does not match its sha256`);
    return { bytes, file };
  }
  const file = path.join('corpus/rendered', `${source.id}.pdf`);
  if (!existsSync(file)) throw new Error(`${file} missing; run corpus:render`);
  if (!source.rendered_pages_sha256) {
    throw new Error('no pinned pagination fingerprint; run corpus:render -- --record');
  }
  const bytes = new Uint8Array(readFileSync(file));
  if (pagesFingerprint(await pdfPageTexts(bytes)) !== source.rendered_pages_sha256) {
    throw new Error(`${file} pagination differs from the pinned fingerprint; re-render`);
  }
  return { bytes, file };
}

const manifest = readManifest(MANIFEST);
const handle = connect(databaseUrl);
const ocr = lazyOcr();
const problems: string[] = [];

try {
  for (const source of manifest.sources) {
    if (only && !only.has(source.id)) continue;
    try {
      const { bytes, file } = await pinnedPdf(source);
      const report = await indexPdf(handle.db, bytes, {
        // Stable across re-renders; see IndexOptions.id.
        id: source.sha256 as string,
        filename: path.basename(file),
        sourceId: source.id,
        ocr,
      });
      console.log(
        `${report.status.padEnd(12)} ${source.id}: ${report.pages} pages, ` +
          `${report.insertedChunks} chunks (replaced ${report.deletedChunks}), ${report.method}`,
      );
      if (report.status !== 'ready') problems.push(`${source.id}: needs review`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(`${source.id}: ${message}`);
      console.error(`FAILED       ${source.id}: ${message}`);
    }
  }

  if (!values['no-embed'] && apiKey) {
    const embedder = openAiEmbedder({ apiKey });
    const embedded = await embedPendingChunks(handle.db, embedder);
    console.log(
      `embedded ${embedded.chunks} chunks with ${embedder.model}: ` +
        `${embedded.inputTokens} tokens, $${embedded.costUsd.toFixed(4)}`,
    );
  }
} finally {
  await ocr.close();
  await handle.close();
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
