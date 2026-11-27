# Fit each filed page onto one PDF page, and key corpus documents by their source hash

Status: accepted (amends 0002 and 0005)
Date: 26 November 2026

## Context

Rendering the real EDGAR corpus for the first time showed two problems that the synthetic fixture couldn't:

1. **OCV Fund I overflowed Letter with one-inch margins.** The filing has 62 `page-break-after: always` markers, so it defines 63 pages. At 100% Chromium printed 121, because most filed pages spilled onto a second PDF page and 15 of those were blank. OCV has no printed page numbers, so the label check reported "no drift" and missed it. NB Crossroads had one overflow (51 PDF pages for 50 filed). Citations would have pointed at pages that exist on no copy anyone has.
2. **Rendered PDFs get new bytes on every render.** Chromium stamps a creation date into each PDF. Document ids were the sha256 of the PDF bytes (0005), so re-rendering a filing would give it a new id. Re-ingesting would then fail on the unique `source_id`, or, without that constraint, orphan its extractions and reviews.

## Decision

- **Shrink to fit the filed pages.** `renderToFiledPages` ([render.ts](../../src/corpus/render.ts)) counts forced page breaks in the HTML and renders at the largest scale in `[1, 0.95, 0.9, 0.85, 0.8]` that gives exactly one PDF page per filed page. OCV fits at 0.9 and NB Crossroads at 0.95. A filing with no forced breaks (Rand Capital SBIC) renders once at 100%. When nothing fits, the 100% render is kept and `corpus:render` reports a problem. The scale and the filed page count go in `corpus/render-report.json`, and the per-page fingerprint still pins the result.
- **Corpus documents use the pinned sha256 of their source file as their id.** `indexPdf` takes an optional `id`, which `corpus:ingest` sets to `source.sha256`. Before ingesting, it checks a raw PDF against that hash and a rendered PDF against its pinned pagination fingerprint, and refuses on a mismatch. Uploaded files still use the sha256 of their bytes.

## Alternatives considered

- **Smaller margins instead of scale:** this changes the page shape, and OCV needed more room than half-inch margins give. Scale keeps Letter with one-inch margins and shrinks the content uniformly, which is what "print to fit" does.
- **Split the HTML on its break markers:** rejected in 0002, and still rejected: Rand has no markers, and older filings use other conventions. Fitting keeps one PDF pipeline and uses the markers only as a check.
- **Strip the creation date so PDF bytes are stable:** needs a PDF rewriting library just to remove a timestamp, and would still change with the Chromium version. The source hash plus the pagination fingerprint already say what we need: the same filing, paginated the same way.
- **Key by `source_id`:** readable, but it isn't content-addressed. A manifest entry edited to point at a different file would keep its old extractions.

## Consequences

- Shrunk text is smaller on the rendered page. It is still the filer's own text and page breaks, and quotes are matched against extracted text, so citations aren't affected.
- A Playwright upgrade can change which scale fits. The fingerprint check catches that, as before.
- One id can now be "sha256 of the source" for corpus documents and "sha256 of the PDF" for uploads. Both are content hashes and satisfy the same constraint. The `source_id` column says which is which.
- Revisit if a filing needs a scale below 0.8: it was probably laid out for a different paper size, which is worth handling directly.
