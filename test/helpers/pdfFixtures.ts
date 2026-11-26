/**
 * Synthetic PDFs built at test time with Chromium, so no third-party document is committed
 * (the same approach as the Python repo's corpus_builder.py).
 */
import type { Browser } from 'playwright';

const PAGE_BREAK = '<div style="page-break-after: always"></div>';

function htmlDocument(body: string): string {
  return `<!doctype html><html lang="en"><body style="font: 12pt serif; margin: 0">${body}</body></html>`;
}

async function printPdf(browser: Browser, html: string): Promise<Uint8Array> {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    return new Uint8Array(
      await page.pdf({
        format: 'Letter',
        margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' },
      }),
    );
  } finally {
    await page.close();
  }
}

/** A PDF with a real text layer: one page per paragraph list. */
export async function textPdf(browser: Browser, pages: readonly string[]): Promise<Uint8Array> {
  const body = pages
    .map((text) =>
      text
        .split('\n')
        .map((line) => `<p>${line}</p>`)
        .join(''),
    )
    .join(PAGE_BREAK);
  return printPdf(browser, htmlDocument(body));
}

/**
 * An image-only PDF: the text is rendered to a PNG, and only the image is printed, so the
 * PDF has no text layer. Stands in for a scanned document.
 */
export async function scannedPdf(browser: Browser, text: string): Promise<Uint8Array> {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  let png: Buffer;
  try {
    await page.setContent(
      htmlDocument(
        `<div style="padding: 40px; font: 28px serif; line-height: 1.5; width: 1000px">${text}</div>`,
      ),
    );
    png = await page.screenshot({ fullPage: true });
  } finally {
    await page.close();
  }
  const img = `<img alt="" style="width: 100%" src="data:image/png;base64,${png.toString('base64')}">`;
  return printPdf(browser, htmlDocument(img));
}

/** A PDF whose pages carry no text and no image. */
export async function blankPdf(browser: Browser, pages = 2): Promise<Uint8Array> {
  return printPdf(
    browser,
    htmlDocument(Array.from({ length: pages }, () => '&nbsp;').join(PAGE_BREAK)),
  );
}
