import { describe, expect, it, vi } from 'vitest';
import {
  checkHash,
  download,
  FetchError,
  isSecHost,
  Pacer,
  requestHeaders,
  sha256,
} from '../../src/corpus/fetch.js';

const SEC_URL = 'https://www.sec.gov/Archives/edgar/data/1/x.htm';
const OTHER_URL = 'https://ilpa.org/wp-content/uploads/x.pdf';
const AGENT = 'Test Operator operator@example.com';

describe('requestHeaders', () => {
  it('requires a declared EDGAR_USER_AGENT with an email for sec.gov', () => {
    expect(() => requestHeaders(SEC_URL, undefined)).toThrow(FetchError);
    expect(() => requestHeaders(SEC_URL, 'just a name')).toThrow(/EDGAR_USER_AGENT/);
    expect(requestHeaders(SEC_URL, AGENT)['User-Agent']).toBe(AGENT);
  });

  it('never sends the operator identity to other hosts', () => {
    const headers = requestHeaders(OTHER_URL, AGENT);
    expect(JSON.stringify(headers)).not.toContain('operator@example.com');
  });

  it('treats only sec.gov and its subdomains as SEC', () => {
    expect(isSecHost('https://sec.gov/x')).toBe(true);
    expect(isSecHost('https://efts.sec.gov/x')).toBe(true);
    expect(isSecHost('https://notsec.gov/x')).toBe(false);
    expect(isSecHost('https://sec.gov.evil.example/x')).toBe(false);
  });
});

describe('checkHash', () => {
  const bytes = new TextEncoder().encode('hello');
  const digest = sha256(bytes);

  it('distinguishes match, unrecorded and mismatch', () => {
    expect(checkHash(digest, bytes)).toEqual({ status: 'match' });
    expect(checkHash(null, bytes)).toEqual({ status: 'unrecorded', actual: digest });
    expect(checkHash('0'.repeat(64), bytes)).toMatchObject({ status: 'mismatch', actual: digest });
  });
});

describe('Pacer', () => {
  it('spaces consecutive calls by the minimum interval', async () => {
    let clock = 1000;
    const sleeps: number[] = [];
    const pacer = new Pacer(
      150,
      () => clock,
      async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    );
    await pacer.wait(); // first call never waits
    clock += 40;
    await pacer.wait(); // 40 ms later: waits the remaining 110
    clock += 500;
    await pacer.wait(); // long after: no wait
    expect(sleeps).toEqual([110]);
  });
});

describe('download', () => {
  const okResponse = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });

  it('paces SEC requests and sends the declared agent', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    const pacer = new Pacer(0);
    const wait = vi.spyOn(pacer, 'wait');
    const bytes = await download(SEC_URL, {
      fetch: fetchMock as unknown as typeof fetch,
      secPacer: pacer,
      edgarUserAgent: AGENT,
    });
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(wait).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init[1].headers as Record<string, string>)['User-Agent']).toBe(AGENT);
  });

  it('does not pace other hosts', async () => {
    const pacer = new Pacer(0);
    const wait = vi.spyOn(pacer, 'wait');
    await download(OTHER_URL, {
      fetch: (async () => okResponse()) as unknown as typeof fetch,
      secPacer: pacer,
      edgarUserAgent: undefined,
    });
    expect(wait).not.toHaveBeenCalled();
  });

  it('turns HTTP errors into FetchError', async () => {
    await expect(
      download(OTHER_URL, {
        fetch: (async () => new Response('nope', { status: 403 })) as unknown as typeof fetch,
        secPacer: new Pacer(0),
        edgarUserAgent: undefined,
      }),
    ).rejects.toThrow(/403/);
  });
});
