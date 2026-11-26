/**
 * Text normalization for matching a quoted passage against page text.
 *
 * PDF text extraction keeps the printed line wraps ("two\npercent"), splits words at
 * end-of-line hyphens ("Partner-\nship"), and mixes straight and curly quotes. A quote the
 * model copied from a page is still verbatim if it matches after undoing exactly those
 * artifacts, and nothing else: no case folding, no punctuation removal, no fuzzy matching.
 */
export function normalizeForMatch(text: string): string {
  return (
    text
      .normalize('NFKC')
      // Join a word split by a line-end hyphen: "Partner-\nship" -> "Partnership".
      .replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, '$1$2')
      .replace(/[‘’‚′]/g, "'")
      .replace(/[“”„″]/g, '"')
      .replace(/[‐‑‒–—−]/g, '-')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** True when `quote` appears in `pageText` once both are normalized. */
export function containsQuote(pageText: string, quote: string): boolean {
  const needle = normalizeForMatch(quote);
  return needle.length > 0 && normalizeForMatch(pageText).includes(needle);
}
