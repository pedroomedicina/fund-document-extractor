import { pathToFileURL } from 'node:url';
import type { Browser } from 'playwright';
import { extractText, getDocumentProxy } from 'unpdf';

/**
 * Print settings for EDGAR HTML. US Letter with one-inch margins is how these exhibits were
 * paginated when filed; Chromium honours the filings' `page-break-before/after` CSS, so the
 * printed page numbers in the text line up with PDF pages when the check passes.
 */
export const PRINT_OPTIONS = {
  format: 'Letter',
  margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' },
  printBackground: false,
} as const;

/**
 * Print scales tried, largest first. Some filings were laid out for a smaller page than
 * Letter with one-inch margins (OCV Fund I at 100% prints each filed page on about two PDF
 * pages, some of them blank), so the render shrinks until each filed page fits on one.
 */
export const RENDER_SCALES = [1, 0.95, 0.9, 0.85, 0.8] as const;

/** Forced page breaks in a filing (`page-break-before/after: always`), case-insensitive. */
export function countForcedBreaks(html: string): number {
  return (html.match(/page-break-(?:before|after)\s*:\s*always/gi) ?? []).length;
}

export interface FittedRender {
  pdf: Uint8Array;
  pages: string[];
  scale: number;
  /** Pages the filing defines (forced breaks + 1), or null when it has no forced breaks. */
  filedPages: number | null;
  /** True when some scale gave exactly one PDF page per filed page. */
  fits: boolean;
}

/**
 * Render at the largest scale in RENDER_SCALES that gives exactly one PDF page per filed
 * page. A filing with no forced breaks has no filed pagination to match, so it renders at
 * 100%. When no scale fits, the 100% render is returned with `fits: false` for the report.
 */
export async function renderToFiledPages(
  render: (scale: number) => Promise<Uint8Array>,
  html: string,
  scales: readonly number[] = RENDER_SCALES,
): Promise<FittedRender> {
  const breaks = countForcedBreaks(html);
  const filedPages = breaks > 0 ? breaks + 1 : null;
  let first: FittedRender | null = null;
  for (const scale of filedPages === null ? scales.slice(0, 1) : scales) {
    const pdf = await render(scale);
    const pages = await pdfPageTexts(pdf);
    const result = { pdf, pages, scale, filedPages, fits: pages.length === filedPages };
    if (filedPages === null || result.fits) return { ...result, fits: true };
    first ??= result;
  }
  if (first === null) throw new Error('renderToFiledPages needs at least one scale');
  return first;
}

/** Render a local HTML file to PDF bytes with headless Chromium. */
export async function renderHtmlToPdf(
  browser: Browser,
  htmlPath: string,
  scale = 1,
): Promise<Uint8Array> {
  const page = await browser.newPage();
  try {
    // EDGAR exhibits are self-contained; block network so a render never depends on sec.gov.
    await page.route('**/*', (route) =>
      route.request().url().startsWith('file:') ? route.continue() : route.abort(),
    );
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    return new Uint8Array(await page.pdf({ ...PRINT_OPTIONS, scale }));
  } finally {
    await page.close();
  }
}

/** Extract each page's text from PDF bytes, one string per page, in page order. */
export async function pdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  // unpdf/pdf.js may transfer (detach) the buffer it is given; pass a copy.
  const pdf = await getDocumentProxy(bytes.slice());
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}
