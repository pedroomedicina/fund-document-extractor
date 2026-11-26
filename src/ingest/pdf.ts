/**
 * PDF ingestion: page-by-page text with an OCR fallback. Port of the Python project's
 * `extract_pdf_with_fallback` (ingest.py) and its moment-2 quality gate.
 *
 * Order: unpdf text layer -> if fewer than MIN_PAGE_COVERAGE of pages have text, OCR the
 * pages without text -> score quality. A PDF that still lacks text is kept, labelled
 * `_low_text`, and sent to review instead of passing silently (Python status item D).
 */
import { extractText, getDocumentProxy, renderPageAsImage } from 'unpdf';
import type { OcrEngine } from './ocr.js';
import {
  MIN_PAGE_COVERAGE,
  type QualityLabel,
  type QualityScore,
  scorePagesQuality,
  textCoverage,
} from './quality.js';

/** A page with fewer letters and digits than this counts as having no text layer. */
export const MIN_PAGE_ALNUM = 20;
/** Render scale for OCR: 2x the PDF's 72 dpi is about 144 dpi, enough for body text. */
export const OCR_RENDER_SCALE = 2;

export type PageSource = 'text_layer' | 'ocr';

export interface IngestedPage {
  pageNumber: number;
  text: string;
  source: PageSource;
}

export type IngestStatus = 'ready' | 'needs_review';

export interface IngestResult {
  status: IngestStatus;
  /** e.g. "unpdf", "unpdf+tesseract", "unpdf_low_text" (kept, but sent to review). */
  method: string;
  /** Every step attempted, in order, with its outcome. Stored on the document row. */
  trace: string[];
  pages: IngestedPage[];
  coverage: number;
  quality: QualityScore;
  /** Why the document needs review, when it does. */
  reviewReason: string | null;
}

export class PdfUnreadableError extends Error {
  override name = 'PdfUnreadableError';
  constructor(
    message: string,
    readonly trace: string[],
  ) {
    super(message);
  }
}

function alnumCount(text: string): number {
  return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
}

export function hasTextLayer(text: string): boolean {
  return alnumCount(text) >= MIN_PAGE_ALNUM;
}

const REVIEW_LABELS: ReadonlySet<QualityLabel> = new Set(['poor', 'failed']);

export interface IngestOptions {
  /** OCR engine for pages without a text layer; null when OCR is unavailable. */
  ocr: OcrEngine | null;
}

export async function ingestPdf(bytes: Uint8Array, options: IngestOptions): Promise<IngestResult> {
  const trace: string[] = [];
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  let texts: string[];
  try {
    // pdf.js may detach the buffer it is given; pass a copy so callers keep theirs.
    pdf = await getDocumentProxy(bytes.slice());
    texts = (await extractText(pdf, { mergePages: false })).text;
  } catch (error) {
    trace.push(`unpdf:fail:${error instanceof Error ? error.message : String(error)}`);
    // The Python chain tried pikepdf/qpdf repair here. There is no maintained JS
    // equivalent; an unreadable file is reported, not guessed at.
    throw new PdfUnreadableError('PDF could not be parsed', trace);
  }

  try {
    const pages: IngestedPage[] = texts.map((text, i) => ({
      pageNumber: i + 1,
      text: text.trim() ? text : '',
      source: 'text_layer',
    }));
    const coverageOf = () => textCoverage(pages.map((p) => (hasTextLayer(p.text) ? p.text : '')));

    let method = 'unpdf';
    let coverage = coverageOf();
    trace.push(
      `unpdf:${coverage >= MIN_PAGE_COVERAGE ? 'ok' : 'low_text'}:coverage=${coverage.toFixed(2)}`,
    );

    if (coverage < MIN_PAGE_COVERAGE) {
      if (options.ocr === null) {
        trace.push('ocr:unavailable');
      } else {
        const engine = options.ocr;
        const missing = pages.filter((p) => !hasTextLayer(p.text));
        let improved = 0;
        for (const page of missing) {
          const png = await renderPageAsImage(pdf, page.pageNumber, {
            canvasImport: () => import('@napi-rs/canvas'),
            scale: OCR_RENDER_SCALE,
          });
          const text = await engine.recognize(new Uint8Array(png));
          // Like ocrmypdf --skip-text: OCR only fills pages without a text layer, and only
          // replaces what was there when it found more.
          if (alnumCount(text) > alnumCount(page.text)) {
            page.text = text;
            page.source = 'ocr';
            improved += 1;
          }
        }
        coverage = coverageOf();
        method = `unpdf+${engine.name}`;
        trace.push(
          `ocr_${engine.name}:pages=${missing.length}:improved=${improved}:coverage=${coverage.toFixed(2)}`,
        );
      }
      if (coverage < MIN_PAGE_COVERAGE) {
        method = `${method}_low_text`;
        trace.push('kept_low_text_extraction');
      }
    }

    const quality = scorePagesQuality(pages.map((p) => p.text));
    let reviewReason: string | null = null;
    if (REVIEW_LABELS.has(quality.label)) {
      reviewReason =
        quality.label === 'failed'
          ? 'no extractable text, even after OCR'
          : `text quality is ${quality.label} (score ${quality.score.toFixed(2)})`;
    }
    return {
      status: reviewReason ? 'needs_review' : 'ready',
      method,
      trace,
      pages,
      coverage,
      quality,
      reviewReason,
    };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
