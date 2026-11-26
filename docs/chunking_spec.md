# Chunking spec

Ported from the Python project's `docs/chunking_spec.md`. The page and size rules are the same; the heading rules are rewritten for fund documents. Code: `src/chunking/chunker.ts`. Tests: `test/chunking/chunker.test.ts`.

## Objective

Produce page-aware chunks that a retriever can rank and an extractor can cite. Each chunk records the pages it spans, the article it sits under, and the numbered sections it contains, so "Section 8.1" in one clause can be resolved to the chunk that holds Section 8.1.

## Input

One document's pages in order: `{ pageNumber, text }`, as produced by ingestion. Documents labelled `poor` or `failed` by the text-quality check are not chunked; they go to review.

## Block detection

Page text is split into heading blocks and paragraph blocks (`splitBlocks`).

- PDF text has no blank lines between paragraphs, so a paragraph ends at:
  - a blank line,
  - a line ending in `. ! ? : ; " ) ]` or a closing curly quote,
  - or just before a list item (`-`, `•`, `1.`, `(a)`, `(iv)`, `a)`).
- Wrapped lines are joined with a space. A line ending in `-` followed by a lowercase word is joined without the hyphen (`Partner-` + `ship` → `Partnership`), the same rule the quote normalizer uses.
- **Article headings:** `ARTICLE VIII`, `Article 8`, alone or with a short title on the same line. A line like `Article 8 of this Agreement…` is a sentence, not a heading.
- **All-caps headings:** an upper-case line of at least five characters, optionally numbered (`DEFINITIONS`, `8. DISTRIBUTIONS`), at most 120 characters.
- **Section starts:** `Section 8.1`, `SECTION 8.1(a)`, `§ 8.1`, or `8.1 Title` (number, then a capital letter). The section number is stored on the paragraph (`8.1`; a subsection letter is dropped).
- Headings and section starts only count **at a paragraph boundary**. LPAs often wrap `…as set forth in` / `Section 8.1 hereof` across lines, and that second line is not a new section.

## Chunk rules

- An article or all-caps heading always starts a new chunk and becomes its `sectionTitle`. Consecutive heading lines join into one title (`ARTICLE VIII DISTRIBUTIONS`). The title carries over to later pages until the next heading.
- A numbered section starts a new chunk once the current chunk has reached `minTokens`. Shorter sections are grouped with the next, so ten one-line sections don't become ten tiny chunks.
- A new article clears the current section number.
- A chunk continues onto the next page only when the pages are contiguous, so a clause that straddles a page break stays together and is cited as `pp. X–Y`. A page with no text in between ends the chunk.
- **Max is a hard limit.** A block that would overflow the current chunk starts a new one, and a paragraph longer than max is split at sentence boundaries (by words if one sentence is longer than max).
- **Min is a soft target.** A chunk is shorter than min only at a heading, a page gap, the end of the document, or before a block that would overflow max.
- Heading-only chunks are dropped.

Defaults: `minTokens` 300 and `maxTokens` 800, where tokens are whitespace-separated words. That's approximate, and good enough for sizing. Embedding-model limits are far above 800 words.

## Chunk fields

| Field                  | Meaning                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `index`                | 0-based position in the document. With content-hash document ids (`documents.id`), `docId:index` is stable for the same file and settings. |
| `pageStart`, `pageEnd` | 1-based PDF pages the chunk spans.                                                                                                         |
| `sectionTitle`         | Article or all-caps heading the chunk sits under; empty before the first heading.                                                          |
| `sectionRefs`          | Section numbers in the chunk, including the one continued from an earlier chunk.                                                           |
| `tokenEstimate`        | Whitespace token count.                                                                                                                    |
| `text`                 | Blocks joined by blank lines.                                                                                                              |

## Changes from the Python version

- Heading rules for legal English replace the Spanish all-caps rule and `Paso N` list items.
- `sectionRefs` and the section-start rule are new; they feed cross-reference resolution in the extractor.
- `minTokens` is used. In the Python version it was accepted and ignored, because every heading there was a hard boundary.
- An end-of-line hyphen before a lowercase word is dropped (`Partnership`), where the Python version kept it (`químico-mecánica`). That suits English legal text and matches the quote normalizer.

## Post-chunk QA

When a new document family is added, sample chunks and check that:

- clauses that straddle pages stay together,
- `sectionTitle` and `sectionRefs` match the printed headings,
- a cited page contains the cited passage (the citation validator checks this automatically for extracted fields).
