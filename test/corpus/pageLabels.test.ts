import { describe, expect, it } from 'vitest';
import {
  checkLabelSequence,
  detectPrintedLabel,
  pagesFingerprint,
} from '../../src/corpus/pageLabels.js';

const page = (body: string, footer: string) => `${body}\nMore text on the page.\n${footer}`;

describe('detectPrintedLabel', () => {
  it.each([
    ['12', '12'],
    ['- 12 -', '12'],
    ['– 7 –', '7'],
    ['Page 4 of 80', '4'],
    ['iv', 'iv'],
    ['A-3', 'A-3'],
  ])('reads the footer %j as %j', (footer, expected) => {
    expect(detectPrintedLabel(page('ARTICLE I', footer))).toBe(expected);
  });

  it('falls back to a header label when the footer has none', () => {
    expect(detectPrintedLabel('17\nSection 8.1 Management Fee.\nThe fee is 2%.')).toBe('17');
  });

  it('does not mistake a section number or a percentage for a page label', () => {
    expect(detectPrintedLabel('Section 8.1\nThe fee is 2%.\nSee Section 9.')).toBeNull();
  });
});

describe('checkLabelSequence', () => {
  it('reports no drift for consecutive labels, ignoring unlabelled and roman pages', () => {
    const report = checkLabelSequence([
      page('Cover', 'i'),
      'no label here',
      page('a', '1'),
      page('b', '2'),
    ]);
    expect(report.labels).toEqual(['i', null, '1', '2']);
    expect(report.drift).toEqual([]);
    expect(report.labelled).toBe(3);
  });

  it('reports a skipped page and a restart (where a second document begins)', () => {
    const report = checkLabelSequence([page('a', '1'), page('b', '3'), page('c', '1')]);
    expect(report.drift).toEqual([
      { pageIndex: 2, previous: '1', label: '3' },
      { pageIndex: 3, previous: '3', label: '1' },
    ]);
  });
});

describe('pagesFingerprint', () => {
  it('changes when text moves to another page, even if the total text is the same', () => {
    expect(pagesFingerprint(['a b', 'c'])).not.toBe(pagesFingerprint(['a', 'b c']));
    expect(pagesFingerprint(['a', 'b'])).toBe(pagesFingerprint(['a', 'b']));
  });
});
