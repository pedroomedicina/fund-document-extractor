import { createHash } from 'node:crypto';
import type { Source } from './manifest.js';

/** SEC fair-access policy: at most 10 requests per second, and a declared User-Agent. */
export const SEC_MIN_INTERVAL_MS = 150;
const GENERIC_USER_AGENT = 'fund-document-extractor-corpus-fetch/0.2';

export class FetchError extends Error {
  override name = 'FetchError';
}

export function isSecHost(url: string): boolean {
  const host = new URL(url).hostname;
  return host === 'sec.gov' || host.endsWith('.sec.gov');
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** File name in corpus/raw/ for a source. */
export function rawFileName(source: Source): string {
  return `${source.id}.${source.kind === 'edgar_html' ? 'htm' : 'pdf'}`;
}

/**
 * Headers for one request. SEC requests carry the operator's declared identity
 * (EDGAR_USER_AGENT, "Name email"); other hosts get a generic agent with no personal data.
 */
export function requestHeaders(
  url: string,
  edgarUserAgent: string | undefined,
): Record<string, string> {
  if (!isSecHost(url)) return { 'User-Agent': GENERIC_USER_AGENT };
  const agent = edgarUserAgent?.trim();
  if (!agent || !/\S+@\S+\.\S+/.test(agent)) {
    throw new FetchError(
      'EDGAR_USER_AGENT must be set to "Your Name your@email" before downloading from sec.gov ' +
        '(SEC fair-access policy). Put it in .env; it is never committed.',
    );
  }
  return { 'User-Agent': agent, 'Accept-Encoding': 'gzip, deflate' };
}

export type HashCheck =
  | { status: 'match' }
  | { status: 'unrecorded'; actual: string }
  | { status: 'mismatch'; expected: string; actual: string };

/** Compare downloaded bytes with the hash pinned in the manifest. */
export function checkHash(expected: string | null, bytes: Uint8Array): HashCheck {
  const actual = sha256(bytes);
  if (expected === null) return { status: 'unrecorded', actual };
  return expected === actual ? { status: 'match' } : { status: 'mismatch', expected, actual };
}

/** Spaces out SEC requests: 150 ms apart is under 7 per second, below the 10/s limit. */
export class Pacer {
  private last = Number.NEGATIVE_INFINITY;
  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async wait(): Promise<void> {
    const elapsed = this.now() - this.last;
    if (elapsed < this.minIntervalMs) await this.sleep(this.minIntervalMs - elapsed);
    this.last = this.now();
  }
}

export interface DownloadDeps {
  fetch: typeof fetch;
  secPacer: Pacer;
  edgarUserAgent: string | undefined;
}

export async function download(url: string, deps: DownloadDeps): Promise<Uint8Array> {
  const headers = requestHeaders(url, deps.edgarUserAgent);
  if (isSecHost(url)) await deps.secPacer.wait();
  const res = await deps.fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new FetchError(`GET ${url} returned ${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
}
