import path from 'node:path';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkLabelSequence, pagesFingerprint } from '../../src/corpus/pageLabels.js';
import { pdfPageTexts, renderHtmlToPdf } from '../../src/corpus/render.js';
import { containsQuote } from '../../src/text/normalize.js';

// Real Chromium, no mocks: this is the claim the corpus design rests on (decision 0002).
const FIXTURE = path.join(import.meta.dirname, '..', 'fixtures', 'corpus', 'edgar-style.htm');

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

describe('renderHtmlToPdf', () => {
  it('honours EDGAR page-break CSS, so printed page numbers match PDF pages', async () => {
    const pages = await pdfPageTexts(await renderHtmlToPdf(browser, FIXTURE));

    expect(pages).toHaveLength(3);
    // Extracted text keeps the printed line wraps, so quotes are matched after normalizing.
    const [first = '', second = '', third = ''] = pages;
    expect(containsQuote(first, '"Management Fee" has the meaning set forth in Section 8.1')).toBe(
      true,
    );
    expect(containsQuote(second, 'equal to two percent (2%) per annum')).toBe(true);
    expect(containsQuote(third, 'Twenty percent (20%) of Net Profits')).toBe(true);
    // And each passage is on its own page only.
    expect(containsQuote(first, 'two percent (2%)')).toBe(false);

    const labels = checkLabelSequence(pages);
    expect(labels.labels).toEqual(['1', '2', '3']);
    expect(labels.drift).toEqual([]);
  }, 30_000);

  it('produces the same pagination fingerprint on every render', async () => {
    const first = await pdfPageTexts(await renderHtmlToPdf(browser, FIXTURE));
    const second = await pdfPageTexts(await renderHtmlToPdf(browser, FIXTURE));
    expect(pagesFingerprint(first)).toBe(pagesFingerprint(second));
  }, 30_000);
});
