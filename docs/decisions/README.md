# Decision records

One file per decision that someone could reasonably ask "why this and not X?" about: a library, a vendor, a data format, a rule. The habit comes from the Python project this design is ported from ([rag-revalida-odontologia](https://github.com/pedroomedicina/rag-revalida-odontologia), `docs/decisions/`).

Rules:

- Number files in order (`0001-…`). Never renumber or delete one; when a decision changes, write a new record with `Status: supersedes 000N` and mark the old one `Status: superseded by 000M`.
- Write the record in the same change as the code it explains.
- List the alternatives you actually considered and why each lost. "Popular" is not a reason.

## Template

```markdown
# <Decision as a short imperative sentence>

Status: accepted
Date: <day month year>

## Context

What problem forced a choice, and what constraints matter.

## Decision

What we chose, in one or two sentences.

## Alternatives considered

- **<Option>**: why it lost.

## Consequences

What this makes easy, what it makes hard, and what would make us revisit it.
```

## Index

| #                                    | Decision                                                       | Status   |
| ------------------------------------ | -------------------------------------------------------------- | -------- |
| [0001](0001-developer-tooling.md)    | Biome, Vitest and TypeScript 7 for developer tooling           | accepted |
| [0002](0002-corpus-and-rendering.md) | Pin the corpus by manifest and render EDGAR HTML with Chromium | accepted |
| [0003](0003-pdf-parser.md)           | Extract PDF text page by page with unpdf                       | accepted |
| [0004](0004-ocr.md)                  | OCR pages without a text layer with tesseract.js               | accepted |
