import { describe, expect, it } from 'vitest';
import { containsQuote, normalizeForMatch } from '../../src/text/normalize.js';

describe('normalizeForMatch', () => {
  it('collapses PDF line wraps and runs of whitespace', () => {
    expect(normalizeForMatch('equal to two\npercent  (2%)\tper annum')).toBe(
      'equal to two percent (2%) per annum',
    );
  });

  it('joins words split by an end-of-line hyphen, but keeps real hyphens', () => {
    expect(normalizeForMatch('the Partner-\nship shall')).toBe('the Partnership shall');
    expect(normalizeForMatch('deal-by-deal waterfall')).toBe('deal-by-deal waterfall');
    // A capital after the break is a hyphenated compound, not a split word.
    expect(normalizeForMatch('Non-\nUnited States')).toBe('Non- United States');
  });

  it('unifies curly quotes and dashes', () => {
    expect(normalizeForMatch('“Management Fee” — the Partner’s')).toBe(
      '"Management Fee" - the Partner\'s',
    );
  });
});

describe('containsQuote', () => {
  const page =
    'Section 8.1 Management Fee. The Partnership shall pay a management fee equal to two\npercent (2%) per annum.';

  it('finds a verbatim quote across a line wrap', () => {
    expect(containsQuote(page, 'a management fee equal to two percent (2%) per annum')).toBe(true);
  });

  it('rejects a paraphrase, a changed number and an empty quote', () => {
    expect(containsQuote(page, 'a management fee of 2% per year')).toBe(false);
    expect(containsQuote(page, 'equal to three percent (3%) per annum')).toBe(false);
    expect(containsQuote(page, '   ')).toBe(false);
  });

  it('is case-sensitive: changing a defined term is not verbatim', () => {
    expect(containsQuote(page, 'THE PARTNERSHIP SHALL PAY')).toBe(false);
  });
});
