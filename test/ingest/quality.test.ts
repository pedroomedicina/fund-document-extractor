import { describe, expect, it } from 'vitest';
import {
  CAUTION_CAP,
  labelForScore,
  plausibleWordRatio,
  scorePagesQuality,
  scoreTextQuality,
  textCoverage,
} from '../../src/ingest/quality.js';

const CLEAN =
  'Section 8.1 Management Fee. The Partnership shall pay to the Manager a management fee ' +
  'equal to two percent (2%) per annum of the aggregate Commitments during the Investment ' +
  'Period, and thereafter of the Invested Capital.';

// What a bad OCR pass over the same sentence looks like.
const OCR_NOISE =
  'S3ct1on 8.l M4nagem3nt F3e. Th3 P4rtn3rsh1p sh4ll p4y t0 th3 M4n4g3r 4 m4n4gem3nt f33 ' +
  '3qu4l t0 tw0 p3rc3nt (2%) p3r 4nnum 0f th3 4ggr3g4t3 C0mm1tm3nts ~~ ¤¤ ¦¦';

const LETTER_SPACED = 'T h e  P a r t n e r s h i p  s h a l l  p a y  t h e  f e e';

describe('scoreTextQuality', () => {
  it('rates clean legal English as good', () => {
    expect(scoreTextQuality(CLEAN).label).toBe('good');
  });

  it('rates OCR noise and letter-spaced text below usable', () => {
    expect(scoreTextQuality(OCR_NOISE).label).toBe('poor');
    expect(scoreTextQuality(LETTER_SPACED).score).toBeLessThan(0.45);
  });

  it('returns failed for empty or whitespace-only text', () => {
    expect(scoreTextQuality('')).toEqual({ score: 0, label: 'failed' });
    expect(scoreTextQuality(' \n\t ')).toEqual({ score: 0, label: 'failed' });
  });

  it('does not penalize a short clean page for being short (Python status item D)', () => {
    expect(scoreTextQuality('ARTICLE VIII\nDistributions.').label).toBe('good');
  });

  it('treats numbers as neutral and the words "a" and "I" as plausible', () => {
    expect(plausibleWordRatio('a fee of 2.5% on 1,000,000 I think')).toBe(1);
  });
});

describe('scorePagesQuality', () => {
  it('ignores blank pages in the mean but caps a document with low text coverage', () => {
    const onePageOfFive = [CLEAN, '', '', '', ''];
    const result = scorePagesQuality(onePageOfFive);
    expect(result.score).toBeLessThanOrEqual(CAUTION_CAP);
    expect(result.label).toBe('usable_with_caution');
  });

  it('labels a document with almost no text as poor, never good', () => {
    expect(scorePagesQuality(['Fee.']).label).toBe('poor');
  });

  it('weights pages by length', () => {
    const mostlyClean = scorePagesQuality([CLEAN.repeat(5), OCR_NOISE]);
    const mostlyNoise = scorePagesQuality([CLEAN, OCR_NOISE.repeat(5)]);
    expect(mostlyClean.score).toBeGreaterThan(mostlyNoise.score);
  });

  it('returns failed when no page has text', () => {
    expect(scorePagesQuality(['', '  '])).toEqual({ score: 0, label: 'failed' });
    expect(scorePagesQuality([])).toEqual({ score: 0, label: 'failed' });
  });
});

describe('helpers', () => {
  it('maps scores to labels at the Python thresholds', () => {
    expect([0.75, 0.74, 0.45, 0.44, 0].map(labelForScore)).toEqual([
      'good',
      'usable_with_caution',
      'usable_with_caution',
      'poor',
      'failed',
    ]);
  });

  it('computes text coverage', () => {
    expect(textCoverage(['a', '', 'b', ' '])).toBe(0.5);
    expect(textCoverage([])).toBe(0);
  });
});
