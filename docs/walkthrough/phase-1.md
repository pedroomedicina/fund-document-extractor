# Phase 1 walkthrough: corpus and foundations

**Goal:** get real fund documents into Postgres as pages and chunks, with page numbers you can defend in front of a lawyer. No LLM yet.

**Commits:** `e098baf` (normalizer) → `5244f0e` (corpus) → `e57ba96` (quality) → `cb47102` (chunker) → `359e0fb` (ingestion) → `1438f38` (Postgres) → `f69d081` (known bugs).

> **Status: be honest about this in the interview.** The building blocks are done and tested on synthetic fixtures. Not done yet:
> - The corpus has **never been fetched or pinned**: all 8 `sha256` values in `corpus/sources.json` are `null`, so there is no render report and no real LPA in the database yet.
> - There is **no script that runs `indexPdf`** on the corpus; only tests call it.
> - **Embeddings aren't computed** (the column exists and is nullable), so **hybrid search (1e) isn't built**.
>
> These are the first things to finish before the extractor, because Phase 2 needs real chunks to retrieve from.

---

## 1. Quote normalizer

**What it does.** [normalize.ts:9](../../src/text/normalize.ts:9) `normalizeForMatch` undoes exactly the artifacts PDF extraction introduces; [containsQuote](../../src/text/normalize.ts:25) checks that a quote appears on a page. Phase 2 uses it to reject any extracted value whose quote isn't really on the cited page.

**How it works.** NFKC → join `Partner-\nship` into `Partnership` (only before a **lowercase** letter, so `non-US` stays) → straight quotes and dashes → collapse whitespace. That's all.

**Why it's so narrow.** It deliberately does **not** lowercase, strip punctuation or fuzzy-match. "2%" vs "20%" or "Limited Partner" vs "limited partner" (a defined term) are different facts. Every extra normalization is a way for a hallucinated quote to pass.

**How it fails.** A quote that crosses a page boundary won't match a single page; Phase 2 checks against the joined text of `page_start..page_end`. Ligatures and odd Unicode are covered by NFKC. Tests: [normalize.test.ts](../../test/text/normalize.test.ts), including "case-sensitive: changing a defined term is not verbatim".

**Likely questions**

- _"Why not fuzzy match with a similarity threshold?"_ A threshold is exactly where a changed number slips through. Exact-after-normalization is explainable and auditable; if it's too strict, the field goes to a human instead of being wrong.
- _"Why was this the first commit of Phase 1?"_ Everything downstream (chunker hyphen rule, Phase 2 validation) has to agree with it.

---

## 2. Corpus manifest and fetch

**What it does.** [corpus/sources.json](../../corpus/sources.json) lists every source: URL, kind (`edgar_html` or `pdf`), expected type, template family, licence, and pinned hashes. [manifest.ts](../../src/corpus/manifest.ts) validates it with Effect Schema; `npm run corpus:fetch` ([scripts/corpus-fetch.ts](../../scripts/corpus-fetch.ts)) downloads into the gitignored `corpus/raw/`. Decision: [0002](../decisions/0002-corpus-and-rendering.md).

**How it works.**

- **Schema + cross-field rules** ([manifest.ts:73](../../src/corpus/manifest.ts:73)): unique ids, `rendered_pages_sha256` only on HTML sources, and `may_commit` implies `public_demo`.
- **Hash pinning** ([fetch.ts:51](../../src/corpus/fetch.ts:51)): each download is `match`, `unrecorded` or `mismatch`. A mismatch is **never written** ([corpus-fetch.ts:68](../../scripts/corpus-fetch.ts:68)): a changed source can move text under existing gold labels. `--record` pins hashes the first time.
- **SEC fair access** ([fetch.ts:30](../../src/corpus/fetch.ts:30), [:58](../../src/corpus/fetch.ts:58)): sec.gov requests require `EDGAR_USER_AGENT` with an email and are paced 150 ms apart (under 10/s). Other hosts get a generic agent — your identity never goes anywhere else.
- `Pacer` takes `now` and `sleep` as parameters, so the test checks the spacing without waiting.

**Why.** Three things: gold labels cite pages, so the source must not change underneath them; most of these files can't be redistributed (ILPA's terms forbid it), so they're fetched, not committed; and EDGAR asks automated clients to identify themselves and stay under 10 req/s.

**What I'd change.** Retry with backoff on 429/5xx; right now a failure is reported and the run exits 1.

**Likely questions**

- _"Why not just commit the PDFs?"_ Licences. ILPA forbids it; EDGAR exhibits are public records but the text belongs to the drafters. The demo shows quotes and links to the filing instead.
- _"What's `template_family` for?"_ Documents from the same template look alike. If eval averages across documents, one template with five copies dominates. Results are reported per family.

---

## 3. EDGAR rendering and page labels

**What it does.** EDGAR LPAs are HTML. `npm run corpus:render` ([scripts/corpus-render.ts](../../scripts/corpus-render.ts)) prints each one to PDF with headless Chromium, reads the printed page number off each page, checks they run consecutively, and pins a fingerprint of the pagination.

**How it works.**

- [render.ts:17](../../src/corpus/render.ts:17): US Letter, 1-inch margins, print media, and **all network blocked** except `file:` — a render never depends on sec.gov being up.
- [pageLabels.ts:18](../../src/corpus/pageLabels.ts:18) `detectPrintedLabel`: looks at the last 3 lines, then the first 3, for `12`, `- 12 -`, `Page 12 of 80`, `iv`, `A-3`.
- [pageLabels.ts:52](../../src/corpus/pageLabels.ts:52) `checkLabelSequence`: numeric labels must go up by one; a restart at 1 is reported as drift because it usually means a second document starts there (useful later for packet segmentation).
- [pageLabels.ts:71](../../src/corpus/pageLabels.ts:71) `pagesFingerprint`: sha256 of the **per-page text array**, not the PDF bytes, because Chromium stamps a creation date so the bytes change every render. If text moves to another page, the fingerprint changes even when the total text is identical (tested).

**Why Chromium print.** It honours the filings' `page-break-before/after` CSS, so the pages match the printed copy a lawyer would cite. Splitting HTML on break markers lost because markers vary by filer and decade. Playwright pins the Chromium build, which keeps page breaks reproducible.

**How it fails.**

- A Playwright upgrade can move page breaks → fingerprint mismatch → render exits 1 with "gold labels may point at the wrong pages". Fix: re-render, read the drift report, re-pin on purpose.
- **Known bug KB-1** ([known-bugs.md](../known-bugs.md)): a lone number at the end of a table (`250`) is taken as the page label. Only the displayed label and drift report are wrong; PDF page numbers, which citations use, are not affected.

**Likely questions**

- _"Why cite PDF page index and also store the printed label?"_ The PDF index is unambiguous and what the viewer jumps to; the printed label is what the lawyer sees on paper. Showing both avoids "page 12" meaning two different things.
- _"How would you fix KB-1?"_ Choose labels for the whole document at once, preferring candidates that continue the sequence from neighbouring pages, instead of deciding each page alone.

---

## 4. PDF ingestion with OCR fallback

**What it does.** [pdf.ts:72](../../src/ingest/pdf.ts:72) `ingestPdf(bytes, { ocr })` returns per-page text, a status (`ready` or `needs_review`), the method used, and a trace of every step. Ported from the Python project's `extract_pdf_with_fallback`. Decisions: [0003 unpdf](../decisions/0003-pdf-parser.md), [0004 tesseract.js](../decisions/0004-ocr.md).

**How it works.**

1. unpdf extracts text per page (`mergePages: false`). If parsing throws → `PdfUnreadableError` with the trace ([pdf.ts:80](../../src/ingest/pdf.ts:80)).
2. A page "has text" if it has ≥ 20 letters/digits ([pdf.ts:61](../../src/ingest/pdf.ts:61)). **Coverage** = share of pages with text.
3. If coverage < 0.8: render only the empty pages at 2x and OCR them; OCR replaces a page only if it found more letters/digits ([pdf.ts:116](../../src/ingest/pdf.ts:116)) — same idea as `ocrmypdf --skip-text`.
4. Still < 0.8 → method gets `_low_text`; it's kept, not dropped.
5. Score quality (next section). `poor` or `failed` → `needs_review` with a reason.
6. `finally` frees the pdf.js document ([pdf.ts:152](../../src/ingest/pdf.ts:152)).

Trace example: `["unpdf:low_text:coverage=0.00", "ocr_tesseract:pages=1:improved=1:coverage=1.00"]`, stored on the document row.

**Why this shape.** The Python audit found an image-only PDF reported as "ingested OK" with zero characters. Every branch here ends in either usable text or an explicit `needs_review` — never a silent empty success. `OcrEngine` is an interface ([ocr.ts:5](../../src/ingest/ocr.ts:5)), so tests use a fake engine for the routing and one real-Tesseract test proves the integration.

**Why tesseract.js.** WebAssembly, so no system binaries: `npm ci` works the same locally, in CI and in the container. The Python version's ocrmypdf fallback was silently unavailable on a dev machine for exactly that reason. Cloud OCR (Textract, Document AI) is better on tables and handwriting but costs per page and sends confidential LP documents to a third party; it can slot in behind `OcrEngine`.

**How it fails.** Slow (~1 s/page) → ingestion time only, never on a request. First run downloads language data from a CDN. No PDF repair step (Python used pikepdf/qpdf; no maintained JS equivalent). pdf.js can detach the input buffer, so it's passed a copy (tested: "leaves the caller's buffer usable").

**What I'd change at scale.** Run ingestion as a queued background job with per-page parallelism and a worker pool for OCR; today it's sequential and in-process.

**Likely questions**

- _"Why 0.8?"_ Ported from the Python project, where it was tuned on real data. A typical LPA has a few blank or signature pages; below 80% something is structurally wrong (a scan, or a broken text layer).
- _"Why not send page images to a vision model?"_ The citation check needs page text that came from the page, not from the model you're trying to validate.

---

## 5. Text-quality score

**What it does.** [quality.ts:72](../../src/ingest/quality.ts:72) scores a page 0–1; [quality.ts:96](../../src/ingest/quality.ts:96) combines pages into a document label: `good` ≥ 0.75, `usable_with_caution` ≥ 0.45, `poor` > 0, `failed` = 0. Answers one question: **is this text good enough to cite?**

**How it works.** Weighted signals:

- 60% — plausible-word ratio ([quality.ts:40](../../src/ingest/quality.ts:40)): letters only, has a vowel, ≤ 25 chars. Catches OCR noise like `m4nagem3nt` and letter-spaced `F e e s`. Numbers are neutral.
- 20% letter ratio, 10% printable, 10% odd-symbol penalty.
- Document score is the length-weighted mean of non-empty pages, capped at 0.74 if coverage < 0.8 and at "poor" if there are < 20 letters in total.

**Why.** Length is a floor, never a bonus: the Python audit found a length term made short clean pages score worse than long noisy ones (tested: "does not penalize a short clean page").

**Likely questions**

- _"Why heuristics instead of OCR confidence?"_ It works the same for text-layer pages and OCR pages, and Tesseract's confidence doesn't catch a broken text layer.
- _"How did you pick the weights?"_ Ported from the Python project's thresholds; Phase 3's eval is where they'd be revisited against real failures.

---

## 6. Chunker

**What it does.** [chunker.ts:176](../../src/chunking/chunker.ts:176) `chunkDocument(pages)` returns chunks with `pageStart/pageEnd`, the article they sit under (`sectionTitle`) and the numbered sections they contain (`sectionRefs`). Spec: [chunking_spec.md](../chunking_spec.md).

**How it works.**

- **Blocks** ([chunker.ts:93](../../src/chunking/chunker.ts:93)): PDF text has no blank lines between paragraphs, so a paragraph ends at a sentence-ending line or before a list item (`(a)`, `(iv)`, `1.`).
- **Headings:** `ARTICLE VIII` (with or without a title) and all-caps lines. `Article 8 of this Agreement…` is a sentence, not a heading.
- **Sections:** `Section 8.1`, `§ 8.1`, `8.1 Title` — **only at a paragraph boundary**, because LPAs wrap "as set forth in\nSection 8.1 hereof" mid-sentence ([chunker.ts:111](../../src/chunking/chunker.ts:111)).
- **Chunk rules:** a heading always starts a chunk; a new section starts one only after `minTokens` (300); `maxTokens` (800) is hard, splitting at sentences, then words; a clause crossing a page break stays together (`pp. 2–3`) unless a blank page sits between.

**Why sections matter.** LPAs are full of "subject to Section 8.1". `sectionRefs` (GIN-indexed in Postgres) lets Phase 2 pull the referenced section into the model's context.

**How it fails.** Odd heading styles (bold mixed case with no number) aren't detected, so a title carries over too far. Tokens are word counts, not model tokens. Only documents that passed the quality gate are chunked ([indexDocument.ts:34](../../src/ingest/indexDocument.ts:34)).

**Likely questions**

- _"Why not LangChain's `RecursiveCharacterTextSplitter`?"_ It's what the old code used. It doesn't know pages or sections, so chunks can't be cited or cross-referenced, and its overlap duplicates text that then has to be de-duplicated in citations.
- _"Why no overlap?"_ Chunk boundaries fall on section and paragraph boundaries, and a section continued from the previous chunk is recorded in `sectionRefs`, so the context isn't lost.

---

## 7. Postgres schema and re-indexing

**What it does.** [schema.ts](../../src/db/schema.ts) defines all tables, including ones Phase 2 will use (`segments`, `extractions`, `reviews`, `llm_calls`). [indexDocument.ts:28](../../src/ingest/indexDocument.ts:28) `indexPdf` runs ingest → chunk → store. Decision: [0005](../decisions/0005-drizzle-postgres.md).

**How it works — the rules worth knowing:**

- **Document id = sha256 of the bytes** ([schema.ts:33](../../src/db/schema.ts:33), with a check constraint). Same file → same id; adding files never renumbers others (the Python bug C1 was positional ids).
- **`pages` stores the text citations are checked against**, never chunks ([schema.ts:55](../../src/db/schema.ts:55)).
- **Re-index in one transaction** ([documents.ts:35](../../src/db/documents.ts:35)): upsert the document, delete + insert pages, delete + insert chunks. A reader never sees half a document, and stale chunks can't survive (Python bug C2: upsert alone left old chunks retrievable). Test: "re-indexing replaces chunks instead of adding stale ones".
- **Hybrid retrieval columns** ([schema.ts:90](../../src/db/schema.ts:90)): a generated `tsvector` with a GIN index for keyword search; `vector(1536)` with an HNSW cosine index, nullable so ingestion works without an API key.
- **`extractions` are append-only, `reviews` point at them** — a reviewer's correction never overwrites what the model said, so you can measure the model.
- **`llm_calls`** records tokens, cost and latency per call, for the eval report and the budget cap.
- Migrations are plain SQL in `drizzle/`, reviewed and committed; CI fails if they drift from `schema.ts`. Tests rebuild a `_test` database from migrations and refuse any other name ([testDb.ts](../../test/helpers/testDb.ts)).

**Why one Postgres instead of a vector DB.** Re-indexing must replace text and vectors together. Two systems means no shared transaction, which is exactly how stale vectors come back. At this corpus size, pgvector + HNSW is plenty.

**What I'd change at scale.** Delete-and-reinsert drops embeddings, so a re-index costs a re-embed; at scale, reuse embeddings for chunks whose text hash didn't change. Partition or add `tenant_id` + row-level security for multi-tenancy.

**Likely questions**

- _"Why Drizzle over Prisma?"_ Prisma treats pgvector as `Unsupported` and needs raw SQL for vector queries and generated columns. Drizzle has both, and its migrations are readable SQL.
- _"What happens if two ingests of the same file run at once?"_ Both transactions upsert the same id; the second waits on the row lock and replaces the first. The result is consistent, but the work is duplicated — a job queue with one job per document id would avoid it.
- _"Why 1536 dimensions?"_ `text-embedding-3-small`. Changing model means a new column and a re-embed, recorded as its own decision.

---

## 8. Known-bug tests

**What it does.** [knownBug.ts](../../test/knownBug.ts) wraps `it.fails`: a test that describes correct behaviour for a confirmed bug and is **expected to fail**. When someone fixes the bug, the test passes, the suite goes red, and the fix must turn `knownBug` into `it` and remove the entry from [known-bugs.md](../known-bugs.md) in the same commit.

**Why.** A bug you found but didn't fix stays visible and documented, and a fix can't land without proving itself. Ported from the Python repo's strict `xfail`.

---

## Explain-back checklist

1. Trace a scanned 10-page PDF through `indexPdf`: what's in the trace, the status, and which tables get rows?
2. Why is the rendered fingerprint a hash of page text and not the PDF?
3. What would happen if `corpus:fetch` overwrote a file whose hash changed?
4. Why does the normalizer join `Partner-\nship` but not lowercase anything?
5. Why are section starts only detected at a paragraph boundary? Give the LPA example.
6. Why is re-indexing a delete + insert in one transaction rather than an upsert?
7. Why do reviews live in their own table instead of updating `extractions`?
8. What's KB-1, what does it affect, and what doesn't it affect?
9. Which parts of Phase 1 are not done yet?
