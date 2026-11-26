import path from 'node:path';
import { createWorker, type Worker } from 'tesseract.js';

/** Turns a page image (PNG bytes) into text. Injected so ingestion can be tested without OCR. */
export interface OcrEngine {
  readonly name: string;
  recognize(png: Uint8Array): Promise<string>;
  close(): Promise<void>;
}

export interface TesseractOptions {
  /** Where language data is cached after the first download. Gitignored. */
  cachePath?: string;
  /** Load language data from here instead of the CDN (for offline or vendored data). */
  langPath?: string;
}

/**
 * tesseract.js (WebAssembly Tesseract): no system binaries, so the same code runs locally,
 * in CI and in the container. English language data is downloaded once and cached.
 */
export async function createTesseractOcr(options: TesseractOptions = {}): Promise<OcrEngine> {
  const worker: Worker = await createWorker('eng', undefined, {
    cachePath: options.cachePath ?? path.resolve('.cache/tesseract'),
    ...(options.langPath ? { langPath: options.langPath } : {}),
  });
  return {
    name: 'tesseract',
    async recognize(png) {
      const { data } = await worker.recognize(Buffer.from(png));
      return data.text;
    },
    async close() {
      await worker.terminate();
    },
  };
}
