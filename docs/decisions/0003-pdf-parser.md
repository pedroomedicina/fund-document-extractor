# Extract PDF text page by page with unpdf

Status: accepted
Date: 25 November 2026

## Context

Every extracted fact cites a page, so the parser must return text **per page**, in reading order, with page numbers that match the PDF viewer the reviewer uses. The previous code used `pdf-parse`, which returns one string for the whole document. The same parser also has to render pages to images for OCR, and the review screen will display pages with pdf.js.

## Decision

Use [unpdf](https://github.com/unjs/unpdf): `extractText(pdf, { mergePages: false })` for per-page text, and `renderPageAsImage` (with `@napi-rs/canvas`) to rasterize pages for OCR.

## Alternatives considered

- **pdf-parse:** one string per document, and its `index.js` runs a self-test that crashes under ESM. Last released years ago.
- **pdfjs-dist directly:** the engine unpdf wraps, and what the review UI uses in the browser. Using it directly means handling the worker setup, Node polyfills and text-item assembly ourselves. unpdf ships a serverless build of the same engine with those solved, so text offsets match what the browser viewer shows.
- **pdf2json / pdfreader:** coordinate-level output, but they lose line structure, which the chunker relies on to find paragraph ends.
- **Poppler `pdftotext` (CLI):** excellent layout fidelity, but needs a system binary in every environment. The Python repo's status audit showed how missing system tools make a pipeline silently degrade.

## Consequences

- The engine is pdf.js in both the server and the review UI, so a passage found on page N server-side is on page N in the viewer.
- pdf.js may detach the buffer it receives, so ingestion passes a copy (tested).
- The document proxy has no `destroy()`; resources are freed with `pdf.loadingTask.destroy()`.
- There is no repair step equivalent to the Python chain's pikepdf/qpdf. An unparseable PDF raises `PdfUnreadableError` with a trace. Revisit if real uploads include damaged PDFs.
