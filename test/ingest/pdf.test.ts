import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTesseractOcr, type OcrEngine } from '../../src/ingest/ocr.js';
import { ingestPdf, PdfUnreadableError } from '../../src/ingest/pdf.js';
import { blankPdf, scannedPdf, textPdf } from '../helpers/pdfFixtures.js';

const CLAUSE =
  'Section 8.1 Management Fee. The Partnership shall pay to the Manager a management fee equal to two percent of aggregate Commitments.';
const CARRY =
  'Section 9.1 Carried Interest. Twenty percent of Net Profits shall be allocated to the General Partner after the Preferred Return.';

/** Records calls and returns canned text; no real OCR. */
function fakeOcr(text: string): OcrEngine & { calls: number } {
  return {
    name: 'fake',
    calls: 0,
    async recognize() {
      this.calls += 1;
      return text;
    },
    async close() {},
  };
}

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

describe('ingestPdf', () => {
  it('reads a PDF with a text layer page by page, without OCR', async () => {
    const ocr = fakeOcr('should not be used');
    const result = await ingestPdf(await textPdf(browser, [CLAUSE, CARRY]), { ocr });

    expect(result).toMatchObject({ status: 'ready', method: 'unpdf', coverage: 1 });
    expect(result.pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(result.pages[0]?.text).toContain('Management Fee');
    expect(result.pages[1]?.text).toContain('Carried Interest');
    expect(result.quality.label).toBe('good');
    expect(ocr.calls).toBe(0);
  }, 30_000);

  it('routes a PDF without a text layer to OCR and keeps page numbers', async () => {
    const ocr = fakeOcr(CLAUSE);
    const result = await ingestPdf(await scannedPdf(browser, CLAUSE), { ocr });

    expect(ocr.calls).toBe(1);
    expect(result.method).toBe('unpdf+fake');
    expect(result.pages[0]).toMatchObject({ pageNumber: 1, source: 'ocr' });
    expect(result.status).toBe('ready');
    expect(result.trace).toEqual([
      'unpdf:low_text:coverage=0.00',
      'ocr_fake:pages=1:improved=1:coverage=1.00',
    ]);
  }, 30_000);

  it('flags a PDF that still has no text for review instead of passing it', async () => {
    const result = await ingestPdf(await blankPdf(browser), { ocr: fakeOcr('') });

    expect(result.status).toBe('needs_review');
    expect(result.method).toBe('unpdf+fake_low_text');
    expect(result.quality.label).toBe('failed');
    expect(result.reviewReason).toMatch(/no extractable text/);
  }, 30_000);

  it('says so in the trace when OCR is unavailable', async () => {
    const result = await ingestPdf(await scannedPdf(browser, CLAUSE), { ocr: null });

    expect(result.status).toBe('needs_review');
    expect(result.method).toBe('unpdf_low_text');
    expect(result.trace).toContain('ocr:unavailable');
  }, 30_000);

  it('sends poor OCR output to review', async () => {
    const noise =
      'S3ct1on 8.l M4nagem3nt F3e Th3 P4rtn3rsh1p sh4ll p4y ~~ ¤¤ ¦¦ 0f th3 C0mm1tm3nts';
    const result = await ingestPdf(await scannedPdf(browser, CLAUSE), { ocr: fakeOcr(noise) });

    expect(result.status).toBe('needs_review');
    expect(result.reviewReason).toMatch(/quality is poor/);
  }, 30_000);

  it('raises PdfUnreadableError with a trace for bytes that are not a PDF', async () => {
    const error = await ingestPdf(new TextEncoder().encode('not a pdf'), { ocr: null }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PdfUnreadableError);
    expect((error as PdfUnreadableError).trace[0]).toMatch(/^unpdf:fail:/);
  });

  it('leaves the caller’s buffer usable', async () => {
    const bytes = await textPdf(browser, [CLAUSE]);
    await ingestPdf(bytes, { ocr: null });
    expect(bytes.byteLength).toBeGreaterThan(0);
  }, 30_000);
});

describe('tesseract OCR (real engine)', () => {
  it('recovers the clause text from an image-only PDF', async () => {
    const ocr = await createTesseractOcr();
    try {
      const result = await ingestPdf(await scannedPdf(browser, CLAUSE), { ocr });
      expect(result.method).toBe('unpdf+tesseract');
      expect(result.status).toBe('ready');
      const text = result.pages[0]?.text ?? '';
      expect(text).toMatch(/Management\s+Fee/);
      expect(text).toMatch(/two\s+percent/);
    } finally {
      await ocr.close();
    }
  }, 120_000);
});
