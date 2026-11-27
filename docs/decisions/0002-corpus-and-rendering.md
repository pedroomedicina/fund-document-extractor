# Pin the corpus by manifest and render EDGAR HTML with Chromium

Status: accepted, amended by [0007](0007-fit-filed-pages-and-stable-corpus-ids.md)
Date: 25 November 2026

## Context

The demo needs public fund documents: LPAs filed on SEC EDGAR, the ILPA model LPAs and notice templates, and later NVCA financing documents. Three facts shaped this decision:

1. **The EDGAR LPAs are HTML, not PDF.** OCV Fund I, NB Crossroads Fund V Holdings and Rand Capital SBIC are all `.htm` exhibits. Every extracted fact cites a page, so an HTML document needs pages that match what a lawyer sees on the printed copy. NB Crossroads carries printed page numbers and `* * *` separators in its HTML.
2. **Most of these files can't be redistributed.** ILPA's Terms of Use (read 25 November 2026) forbid reproducing, publicly displaying or posting their content in a networked environment without written permission. EDGAR exhibits are public records, but the text belongs to its drafters.
3. **Gold labels cite pages.** If a source file or its rendering changes, a hand-written label can silently point at the wrong page. The Python project hit the same class of bug with positional document ids (status item C1).

## Decision

- `corpus/sources.json` is the committed record of the corpus. Each entry has the URL, type, template family, licence summary, a `may_commit` and a `public_demo` flag, and the sha256 of the downloaded bytes. `npm run corpus:fetch` downloads into `corpus/raw/` (gitignored) and refuses to overwrite a file whose hash changed.
- EDGAR HTML is rendered to PDF once with headless Chromium (Playwright), US Letter with one-inch margins and network blocked. Chromium honours the filings' `page-break-before/after` CSS, which a test checks against a synthetic exhibit.
- After rendering, the printed page numbers are read from each page's footer or header and checked to run consecutively. Any drift is written to `corpus/render-report.json`.
- The pinned value for a rendered document is a hash of its **per-page text**, not of the PDF bytes, because Chromium stamps a creation date into every PDF. Gold labels reference this fingerprint, and the eval refuses to score a document whose fingerprint changed.
- ILPA material is `may_commit: false, public_demo: false`: it is used for local development and evaluation only. EDGAR exhibits are `may_commit: false, public_demo: true`: the demo shows quoted passages and links to the filing. No third-party file is committed.
- SEC requests send the operator's `EDGAR_USER_AGENT` from `.env` and are paced at 150 ms, under the SEC's 10 requests/second limit. Other hosts get a generic agent with no personal data.

## Alternatives considered

- **Split the HTML on its page-break markers and keep it as HTML pages:** no browser dependency, and exact for filings with clean markers. It lost because markers are inconsistent across filers and decades (`<hr>`, CSS on `<p>` or `<div>`, `<page>` in old `.txt` filings, or none). A page that overflows its marker in print would also disagree with the printed copy. The rendered PDF gives one pipeline for every document: PDF in, pages out.
- **wkhtmltopdf / WeasyPrint:** lighter than Chromium, but wkhtmltopdf is unmaintained and both need system packages. Playwright pins an exact Chromium build per version, which keeps page boundaries reproducible.
- **Commit the files:** simplest for reviewers, but not allowed for ILPA, and unnecessary for EDGAR, where anyone can fetch the same bytes.
- **Hash the PDF bytes:** fails on every render because of the embedded timestamp.

## Consequences

- Rendering needs Chromium (about 100 MB, installed by `npx playwright install chromium`, and in CI). Production never renders; it serves results computed from the pinned corpus.
- Upgrading Playwright can move page boundaries. The fingerprint check catches it; the fix is to re-render, review the drift report, and re-pin on purpose.
- The public demo will have fewer documents than the local eval set: ILPA templates appear in eval reports (as counts and scores) but not on the site.
- Revisit if ILPA grants written permission, or if a source we need is only available as a scanned PDF. Scans go through the OCR path, not this one.
