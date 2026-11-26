/**
 * Render EDGAR HTML sources from corpus/raw/ to PDF in corpus/rendered/, then check that the
 * printed page numbers follow the PDF pages and pin each document's pagination fingerprint.
 *
 *   npm run corpus:render                fail if a fingerprint differs from the pinned one
 *   npm run corpus:render -- --record    pin fingerprints that are not recorded yet
 *
 * Needs Chromium once: npx playwright install chromium
 * Writes corpus/render-report.json (committed: labels and drift only, no document text).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { rawFileName } from '../src/corpus/fetch.js';
import { readManifest, updateSource, writeManifest } from '../src/corpus/manifest.js';
import { checkLabelSequence, pagesFingerprint } from '../src/corpus/pageLabels.js';
import { pdfPageTexts, renderHtmlToPdf } from '../src/corpus/render.js';

const MANIFEST = 'corpus/sources.json';
const RAW_DIR = 'corpus/raw';
const RENDERED_DIR = 'corpus/rendered';
const REPORT = 'corpus/render-report.json';

const { values } = parseArgs({ options: { record: { type: 'boolean', default: false } } });

let manifest = readManifest(MANIFEST);
mkdirSync(RENDERED_DIR, { recursive: true });
const browser = await chromium.launch();
const report: Record<string, unknown> = {};
const problems: string[] = [];

try {
  for (const source of manifest.sources) {
    if (source.kind !== 'edgar_html') continue;
    const htmlPath = path.join(RAW_DIR, rawFileName(source));
    if (!existsSync(htmlPath)) {
      problems.push(`${source.id}: ${htmlPath} missing; run npm run corpus:fetch first`);
      continue;
    }

    const pdf = await renderHtmlToPdf(browser, path.resolve(htmlPath));
    writeFileSync(path.join(RENDERED_DIR, `${source.id}.pdf`), pdf);
    const pages = await pdfPageTexts(pdf);
    const labels = checkLabelSequence(pages);
    const fingerprint = pagesFingerprint(pages);

    report[source.id] = {
      pages: pages.length,
      labelled_pages: labels.labelled,
      drift: labels.drift,
      fingerprint,
    };
    const driftNote = labels.drift.length === 0 ? 'no drift' : `${labels.drift.length} drift(s)`;
    console.log(`${source.id}: ${pages.length} pages, ${labels.labelled} labelled, ${driftNote}`);

    if (source.rendered_pages_sha256 === null) {
      if (values.record) {
        manifest = updateSource(manifest, source.id, { rendered_pages_sha256: fingerprint });
      } else {
        problems.push(`${source.id}: fingerprint not pinned (re-run with --record)`);
      }
    } else if (source.rendered_pages_sha256 !== fingerprint) {
      problems.push(
        `${source.id}: pagination changed (pinned ${source.rendered_pages_sha256}, now ${fingerprint}). ` +
          'Gold labels for this document may point at the wrong pages.',
      );
    }
  }
} finally {
  await browser.close();
}

writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
if (values.record) writeManifest(MANIFEST, manifest);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
