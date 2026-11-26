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

/** Render a local HTML file to PDF bytes with headless Chromium. */
export async function renderHtmlToPdf(browser: Browser, htmlPath: string): Promise<Uint8Array> {
  const page = await browser.newPage();
  try {
    // EDGAR exhibits are self-contained; block network so a render never depends on sec.gov.
    await page.route('**/*', (route) =>
      route.request().url().startsWith('file:') ? route.continue() : route.abort(),
    );
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    return new Uint8Array(await page.pdf(PRINT_OPTIONS));
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
