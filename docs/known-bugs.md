# Known bugs

Confirmed defects that are not fixed yet. Each one has a `knownBug()` test (see `test/knownBug.ts`) that describes the correct behaviour and is expected to fail. When the fix lands, the test starts passing, the suite fails, and the fix changes `knownBug(...)` to `it(...)` and removes the entry here, in the same commit.

## KB-1: A lone number at the end of a table is read as the printed page label

`detectPrintedLabel` (`src/corpus/pageLabels.ts`) takes the first number-only line among a page's last three lines. In PDF text, a schedule of partners or a fee table often ends with a lone amount (`250`), which becomes the page's "printed label". The render check then reports false drift, and citations show the wrong page label next to the PDF page number.

- **Effect:** wrong `pages.printed_label` and noisy drift reports on pages that end in a table. PDF page numbers, which citations and gold labels use, are not affected.
- **Likely fix:** choose labels for the whole document at once, preferring the candidate on each page that continues the sequence from its neighbours, rather than deciding each page alone.
- **Test:** `test/corpus/pageLabels.test.ts`, "a table amount on the last line is not a page label".
