/**
 * Page-aware chunker for legal documents. Port of the Python project's `chunker.py`
 * (spec: docs/chunking_spec.md), with heading rules for LPAs instead of Spanish course notes.
 *
 * Every chunk knows the pages it spans, the article it sits in (`sectionTitle`), and the
 * numbered sections it contains (`sectionRefs`), so a citation can point at a page and a
 * cross-reference like "Section 8.1" can be resolved to the chunk that holds it.
 */

export interface PageInput {
  /** 1-based page number in the PDF. */
  pageNumber: number;
  text: string;
}

export interface Chunk {
  /** 0-based position in the document. Stable for a given text and settings. */
  index: number;
  pageStart: number;
  pageEnd: number;
  /** The article (or all-caps heading) this chunk sits under; "" before the first heading. */
  sectionTitle: string;
  /** Numbered sections present in the chunk, including one continued from an earlier chunk. */
  sectionRefs: string[];
  tokenEstimate: number;
  text: string;
}

export interface ChunkOptions {
  /** Soft target: a new numbered section starts a new chunk only once this is reached. */
  minTokens: number;
  /** Hard limit: no chunk is longer. */
  maxTokens: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { minTokens: 300, maxTokens: 800 };

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string; sectionRef: string | null };

const MAX_HEADING_CHARS = 120;
/** "ARTICLE VIII", "Article 8", optionally followed by a short title on the same line. */
const ARTICLE_RE = /^article\s+([ivxlc]+|\d+)\b[.:\-–—]?\s*(.*)$/i;
/** An all-caps heading line, optionally numbered: "DEFINITIONS", "8. DISTRIBUTIONS". */
const CAPS_HEADING_RE = /^(?:\d+(?:\.\d+)*[.)]?\s+)?[A-Z][A-Z0-9 \-/&,;'’()]{4,}$/;
/**
 * The title line right after "ARTICLE 6", in any case: "MANAGEMENT FEE; PARTNERSHIP
 * EXPENSES", "General Provisions", "[Reserved]". Without this, a title with no sentence
 * end was read as an unfinished paragraph, and the "6.1 Management Fee." line after it as
 * a wrapped continuation, so section 6.1 was lost.
 */
const ARTICLE_TITLE_RE = /^[[A-Z][A-Za-z0-9 \-/&,;'’()[\]]{1,80}$/;
/** "Section 8.1", "SECTION 8.1(a)", "§ 8.1". */
const SECTION_WORD_RE = /^(?:section|sec\.|§)\s*(\d+(?:\.\d+)*)(?:\([a-z0-9]+\))?[.:]?(?:\s|$)/i;
/** "8.1 Management Fee." (a numbered section without the word "Section"). */
const SECTION_NUMBER_RE = /^(\d+\.\d+(?:\.\d+)*)\.?\s+[A-Z]/;
const SENTENCE_END_RE = /[.!?:;")\]”]$/;
/** List items end the previous paragraph: "-", "•", "1.", "(a)", "(iv)", "a)". */
const LIST_ITEM_RE = /^(?:[-•●▪*·]\s|\d+[.)]\s|\([a-z]{1,2}\)\s|\([ivxl]+\)\s|[a-z]\)\s)/i;
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;

export function estimateTokens(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

function joinLines(lines: readonly string[]): string {
  let joined = '';
  for (const line of lines) {
    if (joined.endsWith('-') && /^\p{Ll}/u.test(line)) {
      // "Partner-" + "ship": an end-of-line hyphen splitting a word (same rule as the
      // quote normalizer, so chunk text and quote matching agree).
      joined = joined.slice(0, -1) + line;
    } else {
      joined = joined ? `${joined} ${line}` : line;
    }
  }
  return joined.replace(/\s+/g, ' ').trim();
}

function headingText(line: string): string | null {
  if (line.length > MAX_HEADING_CHARS) return null;
  const article = ARTICLE_RE.exec(line);
  if (article) {
    const rest = (article[2] ?? '').trim();
    // "ARTICLE VIII" alone or with a title; not a wrapped sentence that starts with "Article 8 of".
    if (rest === '' || CAPS_HEADING_RE.test(rest) || /^[A-Z][A-Za-z ,&'’\-/]{0,80}$/.test(rest)) {
      return line.replace(/\s+/g, ' ');
    }
    return null;
  }
  return CAPS_HEADING_RE.test(line) ? line.replace(/\s+/g, ' ') : null;
}

/** A line that titles the article heading just before it (see ARTICLE_TITLE_RE). */
function articleTitle(line: string, previous: Block | undefined): string | null {
  if (previous?.kind !== 'heading' || !ARTICLE_RE.test(previous.text)) return null;
  if (sectionRefOf(line) || !ARTICLE_TITLE_RE.test(line)) return null;
  return line.replace(/\s+/g, ' ');
}

function sectionRefOf(line: string): string | null {
  return SECTION_WORD_RE.exec(line)?.[1] ?? SECTION_NUMBER_RE.exec(line)?.[1] ?? null;
}

/** Split one page's text into heading and paragraph blocks. */
export function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let bufferRef: string | null = null;

  const flush = () => {
    const joined = joinLines(buffer);
    if (joined) blocks.push({ kind: 'paragraph', text: joined, sectionRef: bufferRef });
    buffer = [];
    bufferRef = null;
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    // Section starts and headings only count at a paragraph boundary: LPAs often wrap
    // "...as set forth in\nSection 8.1 hereof" mid-sentence.
    const atBoundary = buffer.length === 0;
    const heading = atBoundary ? (headingText(line) ?? articleTitle(line, blocks.at(-1))) : null;
    if (heading) {
      blocks.push({ kind: 'heading', text: heading });
      continue;
    }
    const ref = atBoundary ? sectionRefOf(line) : null;
    if (ref || LIST_ITEM_RE.test(line)) flush();
    if (ref) bufferRef = ref;
    buffer.push(line);
    if (SENTENCE_END_RE.test(line)) flush();
  }
  flush();
  return blocks;
}

/**
 * Split text into pieces of at most `firstLimit`, then `limit`, tokens. Breaks at sentence
 * boundaries; a single sentence longer than the limit is cut by words.
 */
export function splitToLimits(text: string, firstLimit: number, limit: number): string[] {
  const first = Math.max(firstLimit, 1);
  if (estimateTokens(text) <= first) return [text];

  const pieces: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  const budget = () => (pieces.length === 0 ? first : limit);
  const emit = () => {
    if (current.length > 0) pieces.push(current.join(' '));
    current = [];
    currentTokens = 0;
  };

  for (const sentence of text.split(SENTENCE_SPLIT_RE)) {
    let words = sentence.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    if (currentTokens + words.length > budget()) emit();
    while (words.length > budget()) {
      const cut = budget();
      pieces.push(words.slice(0, cut).join(' '));
      words = words.slice(cut);
    }
    if (words.length > 0) {
      current.push(words.join(' '));
      currentTokens += words.length;
    }
  }
  emit();
  return pieces;
}

/**
 * Group blocks into chunks of at most maxTokens.
 *
 * - An article heading always starts a new chunk and becomes its sectionTitle; the title
 *   carries over to later pages until the next heading. Consecutive heading lines
 *   ("ARTICLE VIII" then "DISTRIBUTIONS") form one title.
 * - A numbered section starts a new chunk once the current chunk has minTokens.
 * - A chunk continues onto the next page only when pages are contiguous; a page with no
 *   text in between ends the chunk.
 * - A paragraph longer than maxTokens is split at sentence boundaries.
 */
export function chunkDocument(
  pages: readonly PageInput[],
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): Chunk[] {
  const { minTokens, maxTokens } = options;
  if (minTokens > maxTokens) throw new RangeError('minTokens must not exceed maxTokens');

  const chunks: Chunk[] = [];
  let parts: string[] = [];
  let tokens = 0;
  let pageStart = 0;
  let pageEnd = 0;
  let hasBody = false;
  let refs: string[] = [];
  // Running state across chunks and pages.
  let title = '';
  let titleOpen = false; // true while consecutive heading lines are still building a title
  let currentRef: string | null = null;
  let chunkTitle = '';

  const add = (text: string, page: number, body: boolean) => {
    if (parts.length === 0) {
      pageStart = page;
      chunkTitle = title;
      refs = currentRef ? [currentRef] : [];
    }
    parts.push(text);
    tokens += estimateTokens(text);
    pageEnd = page;
    hasBody ||= body;
  };

  const flush = () => {
    const text = parts.join('\n\n').trim();
    if (hasBody && text) {
      chunks.push({
        index: chunks.length,
        pageStart,
        pageEnd,
        sectionTitle: chunkTitle,
        sectionRefs: refs,
        tokenEstimate: estimateTokens(text),
        text,
      });
    }
    parts = [];
    tokens = 0;
    hasBody = false;
    refs = [];
  };

  for (const page of pages) {
    const blocks = splitBlocks(page.text ?? '');
    if (blocks.length === 0) continue;
    if (parts.length > 0 && page.pageNumber !== pageEnd + 1) flush();

    for (const block of blocks) {
      if (block.kind === 'heading') {
        if (hasBody) flush();
        title = titleOpen ? `${title} ${block.text}` : block.text;
        titleOpen = true;
        currentRef = null; // a new article: earlier section numbers no longer apply
        chunkTitle = title;
        add(block.text, page.pageNumber, false);
        continue;
      }
      titleOpen = false;

      if (block.sectionRef) {
        if (hasBody && tokens >= minTokens) flush();
        currentRef = block.sectionRef;
        if (parts.length > 0 && !refs.includes(block.sectionRef)) refs.push(block.sectionRef);
      }

      const pendingHeadingTokens = hasBody ? 0 : tokens;
      for (const piece of splitToLimits(block.text, maxTokens - pendingHeadingTokens, maxTokens)) {
        if (hasBody && tokens + estimateTokens(piece) > maxTokens) flush();
        add(piece, page.pageNumber, true);
      }
    }
  }
  flush();
  return chunks;
}
