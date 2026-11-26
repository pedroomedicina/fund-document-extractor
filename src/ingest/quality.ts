/**
 * Text-quality scoring for extracted pages, ported from the Python project's
 * `ocr_quality_checks.py` (score_text_quality / score_pages_quality).
 *
 * The score answers one question: is this text good enough to cite? It is built from
 * character and word signals only. Length is a floor, never a bonus: the Python status
 * audit found that a length term made short, clean pages look worse than long noisy ones.
 */

export type QualityLabel = 'good' | 'usable_with_caution' | 'poor' | 'failed';

export const GOOD_SCORE = 0.75;
export const USABLE_SCORE = 0.45;
/** A document missing text on too many pages can be at most "usable_with_caution". */
export const CAUTION_CAP = 0.74;
/** Same threshold ingestion uses before trying OCR. */
export const MIN_PAGE_COVERAGE = 0.8;
/** Letters and digits; below this there is not enough text to judge. */
export const MIN_TEXT_CHARS = 20;
const MAX_WORD_LENGTH = 25;

const ODD_SYMBOL_RE = /[^\p{L}\p{N}\s.,;:?!\-()/%°•–—“”‘’"'$§&[\]*]/gu;
const WORD_SPLIT_RE = /[\s\-/–—]+/u;
const NUMBER_RE = /^\d+(?:[.,:]\d+)*$/;
const VOWEL_RE = /[aeiouyáéíóúü]/iu;
const EDGE_PUNCT_RE = /^[.,;:?!()[\]%°•“”‘’"'$§*]+|[.,;:?!()[\]%°•“”‘’"'$§*]+$/gu;
const SINGLE_LETTER_WORDS = new Set(['a', 'i']);
const ALNUM_RE = /[\p{L}\p{N}]/u;
const ALPHA_RE = /\p{L}/u;
const ONLY_LETTERS_RE = /^\p{L}+$/u;

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Share of words that look like words: only letters, with a vowel, not run together.
 * Plain numbers are neutral. Catches OCR noise such as "m4nagem3nt" or "F e e s".
 */
export function plausibleWordRatio(text: string): number {
  let words = 0;
  let plausible = 0;
  for (const raw of text.split(WORD_SPLIT_RE)) {
    const token = raw.replace(EDGE_PUNCT_RE, '');
    if (!ALNUM_RE.test(token) || NUMBER_RE.test(token)) continue;
    words += 1;
    if (token.length === 1) {
      if (SINGLE_LETTER_WORDS.has(token.toLowerCase())) plausible += 1;
    } else if (
      ONLY_LETTERS_RE.test(token) &&
      token.length <= MAX_WORD_LENGTH &&
      VOWEL_RE.test(token)
    ) {
      plausible += 1;
    }
  }
  return ratio(plausible, words);
}

export function labelForScore(score: number): QualityLabel {
  if (score >= GOOD_SCORE) return 'good';
  if (score >= USABLE_SCORE) return 'usable_with_caution';
  return score > 0 ? 'poor' : 'failed';
}

export interface QualityScore {
  score: number;
  label: QualityLabel;
}

/** Score one page on character and word signals. */
export function scoreTextQuality(input: string): QualityScore {
  const text = (input ?? '').normalize('NFC');
  const visible = [...text].filter((ch) => !/\s/u.test(ch));
  const total = visible.length;
  if (total === 0) return { score: 0, label: 'failed' };

  // Control and private-use characters are what "not printable" means in PDF output.
  const printable = visible.filter((ch) => !/[\p{Cc}\p{Co}\p{Cs}�]/u.test(ch)).length;
  const alpha = visible.filter((ch) => ALPHA_RE.test(ch)).length;
  const odd = text.match(ODD_SYMBOL_RE)?.length ?? 0;

  const score =
    // Full marks from 95% plausible words, none at 50% or less.
    Math.max(0, Math.min(1, (plausibleWordRatio(text) - 0.5) / 0.45)) * 0.6 +
    Math.min(1, ratio(alpha, total) / 0.7) * 0.2 +
    ratio(printable, total) * 0.1 +
    Math.max(0, 1 - ratio(odd, total) * 4) * 0.1;
  return { score, label: labelForScore(score) };
}

/**
 * Length-weighted mean of page scores. Empty pages don't dilute the score, but a document
 * missing text on too many pages cannot be "good", and one with almost no text is "poor".
 */
export function scorePagesQuality(pages: readonly string[]): QualityScore {
  const texts = pages.filter((page) => page.trim().length > 0);
  if (texts.length === 0) return { score: 0, label: 'failed' };

  const weights = texts.map((page) => [...page].filter((ch) => !/\s/u.test(ch)).length);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let score =
    texts.reduce((sum, page, i) => sum + scoreTextQuality(page).score * (weights[i] ?? 0), 0) /
    totalWeight;

  if (ratio(texts.length, pages.length) < MIN_PAGE_COVERAGE) score = Math.min(score, CAUTION_CAP);
  const alnum = texts.reduce(
    (n, page) => n + [...page].filter((ch) => ALNUM_RE.test(ch)).length,
    0,
  );
  if (alnum < MIN_TEXT_CHARS) score = Math.min(score, USABLE_SCORE - 0.01);
  return { score, label: labelForScore(score) };
}

/** Share of pages with any text. Ingestion tries OCR below MIN_PAGE_COVERAGE. */
export function textCoverage(pages: readonly string[]): number {
  return ratio(pages.filter((page) => page.trim().length > 0).length, pages.length);
}
