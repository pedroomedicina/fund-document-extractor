import { describe, expect, it } from 'vitest';
import {
  type Chunk,
  chunkDocument,
  estimateTokens,
  splitBlocks,
  splitToLimits,
} from '../../src/chunking/chunker.js';

const words = (n: number, word = 'term') => Array.from({ length: n }, () => word).join(' ');
const sentence = (n: number) => `${words(n - 1)} end.`;
const small = { minTokens: 20, maxTokens: 60 };

function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1);
  return items[0] as T;
}

describe('splitBlocks', () => {
  it('ends a paragraph at a sentence end, since PDF text has no blank lines', () => {
    const blocks = splitBlocks('The Partnership shall pay\na fee.\nThe Manager shall\nreport.');
    expect(blocks.map((b) => b.text)).toEqual([
      'The Partnership shall pay a fee.',
      'The Manager shall report.',
    ]);
  });

  it('recognises article headings and all-caps titles', () => {
    const blocks = splitBlocks('ARTICLE VIII\nDISTRIBUTIONS\nArticle 2 Organization\nText here.');
    expect(blocks.filter((b) => b.kind === 'heading').map((b) => b.text)).toEqual([
      'ARTICLE VIII',
      'DISTRIBUTIONS',
      'Article 2 Organization',
    ]);
  });

  it('does not treat a wrapped sentence starting with "Article 8 of" as a heading', () => {
    const blocks = splitBlocks('Article 8 of this Agreement sets out the waterfall, and the');
    expect(only(blocks).kind).toBe('paragraph');
  });

  it('tags numbered sections at a paragraph boundary', () => {
    const blocks = splitBlocks(
      'Section 8.1 Management Fee. The fee is 2%.\n8.2 Offsets. Fees are offset.\nSECTION 9.1(a) Carry.',
    );
    expect(blocks.map((b) => (b.kind === 'paragraph' ? b.sectionRef : null))).toEqual([
      '8.1',
      '8.2',
      '9.1',
    ]);
  });

  it('ignores "Section 8.1" when a line wrap puts it at the start of a line mid-sentence', () => {
    const blocks = splitBlocks('The fee has the meaning set forth in\nSection 8.1 hereof.');
    const block = only(blocks);
    expect(block).toMatchObject({ kind: 'paragraph', sectionRef: null });
    expect(block.text).toBe('The fee has the meaning set forth in Section 8.1 hereof.');
  });

  it('starts a new paragraph at legal list items', () => {
    const blocks = splitBlocks('the following events\n(a) the death of a Key Person\n(ii) removal');
    expect(blocks).toHaveLength(3);
  });

  it('joins a word split by an end-of-line hyphen', () => {
    expect(only(splitBlocks('the Partner-\nship shall pay.')).text).toBe(
      'the Partnership shall pay.',
    );
  });
});

describe('splitToLimits', () => {
  it('splits at sentence boundaries and never exceeds the limit', () => {
    const text = [sentence(10), sentence(10), sentence(10)].join(' ');
    const pieces = splitToLimits(text, 25, 25);
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) expect(estimateTokens(piece)).toBeLessThanOrEqual(25);
  });

  it('cuts a single over-long sentence by words', () => {
    const pieces = splitToLimits(words(55), 20, 20);
    expect(pieces.map(estimateTokens)).toEqual([20, 20, 15]);
  });

  it('honours a smaller first limit (room left after a heading)', () => {
    const pieces = splitToLimits(words(30), 10, 20);
    expect(pieces.map(estimateTokens)).toEqual([10, 20]);
  });
});

describe('chunkDocument', () => {
  const allWithinMax = (chunks: Chunk[], max: number) =>
    chunks.every((c) => c.tokenEstimate <= max);

  it('starts a chunk at an article heading and carries the title across pages', () => {
    const chunks = chunkDocument(
      [
        { pageNumber: 1, text: `ARTICLE I\nDEFINITIONS\n${sentence(15)}` },
        { pageNumber: 2, text: `${sentence(50)}\n${sentence(50)}` },
        { pageNumber: 3, text: `ARTICLE II\nORGANIZATION\n${sentence(10)}` },
      ],
      small,
    );
    expect(chunks.map((c) => c.sectionTitle)).toEqual([
      'ARTICLE I DEFINITIONS',
      'ARTICLE I DEFINITIONS',
      'ARTICLE I DEFINITIONS',
      'ARTICLE II ORGANIZATION',
    ]);
    expect(chunks[0]?.text.startsWith('ARTICLE I\n\nDEFINITIONS')).toBe(true);
    expect(allWithinMax(chunks, small.maxTokens)).toBe(true);
  });

  it('keeps a passage that straddles contiguous pages in one chunk, cited pp. 2-3', () => {
    const chunks = chunkDocument(
      [
        { pageNumber: 2, text: 'Section 8.1 Management Fee. The Partnership shall pay' },
        { pageNumber: 3, text: 'a management fee of two percent.' },
      ],
      small,
    );
    expect(only(chunks)).toMatchObject({ pageStart: 2, pageEnd: 3, sectionRefs: ['8.1'] });
  });

  it('ends a chunk at a page gap (an empty page in between)', () => {
    const chunks = chunkDocument(
      [
        { pageNumber: 1, text: sentence(5) },
        { pageNumber: 2, text: '   ' },
        { pageNumber: 3, text: sentence(5) },
      ],
      small,
    );
    expect(chunks.map((c) => [c.pageStart, c.pageEnd])).toEqual([
      [1, 1],
      [3, 3],
    ]);
  });

  it('merges short sections until minTokens, then starts a new chunk at the next section', () => {
    const text = [
      `Section 8.1 Fee. ${sentence(8)}`,
      `Section 8.2 Offset. ${sentence(8)}`,
      `Section 8.3 Expenses. ${sentence(8)}`,
      `Section 8.4 Reports. ${sentence(8)}`,
    ].join('\n');
    const chunks = chunkDocument([{ pageNumber: 1, text }], small);
    expect(chunks.map((c) => c.sectionRefs)).toEqual([
      ['8.1', '8.2'],
      ['8.3', '8.4'],
    ]);
    expect(chunks[0]?.tokenEstimate).toBeGreaterThanOrEqual(small.minTokens);
  });

  it('records the section a chunk continues from when a long section is split', () => {
    const chunks = chunkDocument(
      [
        {
          pageNumber: 1,
          text: `Section 9.1 Carried Interest. ${[1, 2, 3].map(() => sentence(30)).join(' ')}`,
        },
      ],
      small,
    );
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.sectionRefs).toEqual(['9.1']);
    expect(allWithinMax(chunks, small.maxTokens)).toBe(true);
  });

  it('forgets section numbers at a new article', () => {
    const chunks = chunkDocument(
      [{ pageNumber: 1, text: `Section 8.1 Fee. ${sentence(30)}\nARTICLE IX\n${sentence(30)}` }],
      small,
    );
    expect(chunks.map((c) => c.sectionRefs)).toEqual([['8.1'], []]);
  });

  it('enforces maxTokens as a hard limit on a long document', () => {
    const pages = Array.from({ length: 6 }, (_, i) => ({
      pageNumber: i + 1,
      text: `Section ${i + 1}.1 Title. ${sentence(90)}\n${sentence(45)}`,
    }));
    const chunks = chunkDocument(pages, { minTokens: 100, maxTokens: 120 });
    expect(allWithinMax(chunks, 120)).toBe(true);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it('drops heading-only chunks and returns nothing for empty input', () => {
    expect(chunkDocument([{ pageNumber: 1, text: 'ARTICLE XII' }], small)).toEqual([]);
    expect(chunkDocument([], small)).toEqual([]);
  });

  it('rejects minTokens above maxTokens', () => {
    expect(() => chunkDocument([], { minTokens: 10, maxTokens: 5 })).toThrow(RangeError);
  });
});
