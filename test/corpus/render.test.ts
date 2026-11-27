import path from 'node:path';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkLabelSequence, pagesFingerprint } from '../../src/corpus/pageLabels.js';
import {
  countForcedBreaks,
  pdfPageTexts,
  renderHtmlToPdf,
  renderToFiledPages,
} from '../../src/corpus/render.js';
import { containsQuote } from '../../src/text/normalize.js';

// Real Chromium, no mocks: this is the claim the corpus design rests on (decision 0002).
const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures', 'corpus');
const FIXTURE = path.join(FIXTURES, 'edgar-style.htm');
const FOUR_PAGES = path.join(FIXTURES, 'four-pages.htm');

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

describe('renderToFiledPages', () => {
  // A filing with two forced breaks defines three pages. The fake overflows them at 100%.
  const html =
    '<p>one</p><hr style="page-break-after:always"><p>two</p>' +
    '<div style="PAGE-BREAK-BEFORE: always">three</div>';

  it('counts forced breaks whatever the case or spacing', () => {
    expect(countForcedBreaks(html)).toBe(2);
    expect(countForcedBreaks('<hr>')).toBe(0);
  });

  it('shrinks to the largest scale that gives one PDF page per filed page', async () => {
    const tried: number[] = [];
    const result = await renderToFiledPages(async (scale) => {
      tried.push(scale);
      // Real 3-page PDF at scale <= 0.9, otherwise a 4-page one (overflow).
      return renderHtmlToPdf(browser, scale <= 0.9 ? FIXTURE : FOUR_PAGES);
    }, html);
    expect(result.fits).toBe(true);
    expect(result.scale).toBe(0.9);
    expect(result.pages).toHaveLength(3);
    expect(tried).toEqual([1, 0.95, 0.9]);
  }, 60_000);

  it('reports fits: false and keeps the 100% render when nothing fits', async () => {
    const result = await renderToFiledPages(
      () => renderHtmlToPdf(browser, FOUR_PAGES),
      html,
      [1, 0.9],
    );
    expect(result).toMatchObject({ fits: false, scale: 1, filedPages: 3 });
  }, 60_000);

  it('renders a filing without forced breaks once, at 100%', async () => {
    const tried: number[] = [];
    const result = await renderToFiledPages(async (scale) => {
      tried.push(scale);
      return renderHtmlToPdf(browser, FIXTURE);
    }, '<p>no breaks</p>');
    expect(result).toMatchObject({ fits: true, scale: 1, filedPages: null });
    expect(tried).toEqual([1]);
  }, 30_000);
});
