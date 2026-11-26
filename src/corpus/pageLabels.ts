import { createHash } from 'node:crypto';

/**
 * Printed page labels: the page number a reader sees in the footer or header of a page
 * ("12", "- 12 -", "Page 12 of 80", "iv", "A-3"). Citations show these next to the PDF page
 * index, and the render check uses them to tell whether pagination drifted.
 */
const LABEL_PATTERNS: readonly RegExp[] = [
  /^[-–—]?\s*(\d{1,4})\s*[-–—]?$/, // 12, -12-, – 12 –
  /^page\s+(\d{1,4})(?:\s+of\s+\d{1,4})?$/i, // Page 12, Page 12 of 80
  /^([ivxlcdm]{1,7})$/i, // iv (front matter)
  /^([A-Z]{1,2}-\d{1,3})$/, // A-3, EX-2 (exhibit/schedule pages)
];

const EDGE_LINES = 3;

/** Return the printed label of a page, looking at its last lines first, then its first lines. */
export function detectPrintedLabel(pageText: string): string | null {
  const lines = pageText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const candidates = [...lines.slice(-EDGE_LINES).reverse(), ...lines.slice(0, EDGE_LINES)];
  for (const line of candidates) {
    for (const pattern of LABEL_PATTERNS) {
      const match = pattern.exec(line);
      if (match?.[1]) return match[1];
    }
  }
  return null;
}

export interface LabelDrift {
  /** 1-based PDF page index where the sequence broke. */
  pageIndex: number;
  previous: string;
  label: string;
}

export interface LabelReport {
  labels: (string | null)[];
  labelled: number;
  /** Places where a numeric label is not the previous numeric label + 1. */
  drift: LabelDrift[];
}

/**
 * Check that numeric printed labels increase by one from page to page. Roman numerals and
 * exhibit labels start their own sequences and are not checked. A restart at 1 is drift too:
 * it usually means a second document (an exhibit or a packet) begins there.
 */
export function checkLabelSequence(pages: readonly string[]): LabelReport {
  const labels = pages.map(detectPrintedLabel);
  const drift: LabelDrift[] = [];
  let previous: { label: string; value: number } | null = null;
  for (const [index, label] of labels.entries()) {
    if (label === null || !/^\d+$/.test(label)) continue;
    const value = Number(label);
    if (previous !== null && value !== previous.value + 1) {
      drift.push({ pageIndex: index + 1, previous: previous.label, label });
    }
    previous = { label, value };
  }
  return { labels, labelled: labels.filter((label) => label !== null).length, drift };
}

/**
 * Fingerprint of a document's pagination: the hash of its per-page text. Two renders with
 * the same fingerprint put the same text on the same pages, so page-cited gold labels hold.
 */
export function pagesFingerprint(pages: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(pages)).digest('hex');
}
