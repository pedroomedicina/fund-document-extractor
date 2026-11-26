import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type Manifest,
  parseManifest,
  readManifest,
  updateSource,
} from '../../src/corpus/manifest.js';

const MANIFEST_PATH = path.join(import.meta.dirname, '..', '..', 'corpus', 'sources.json');

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: 'example-lpa',
    title: 'Example',
    publisher: 'Example',
    url: 'https://www.sec.gov/Archives/example.htm',
    kind: 'edgar_html',
    expected_type: 'lpa',
    template_family: 'example',
    license: { summary: 'public filing', may_commit: false, public_demo: true },
    sha256: null,
    rendered_pages_sha256: null,
    ...overrides,
  };
}

describe('corpus/sources.json', () => {
  const manifest = readManifest(MANIFEST_PATH);

  it('parses against the schema', () => {
    expect(manifest.sources.length).toBeGreaterThan(0);
  });

  it('keeps ILPA material off the public demo and out of git (ILPA Terms of Use)', () => {
    const ilpa = manifest.sources.filter((s) => s.publisher.includes('Institutional Limited'));
    expect(ilpa.length).toBeGreaterThan(0);
    for (const s of ilpa) {
      expect(s.license, s.id).toMatchObject({ may_commit: false, public_demo: false });
    }
  });

  it('commits no third-party file in this version', () => {
    expect(manifest.sources.filter((s) => s.license.may_commit)).toEqual([]);
  });
});

describe('parseManifest', () => {
  it('rejects duplicate ids', () => {
    expect(() => parseManifest({ sources: [source(), source()], wanted: [] })).toThrow(/duplicate/);
  });

  it('rejects a committable file that may not be shown on the demo', () => {
    const bad = source({ license: { summary: 's', may_commit: true, public_demo: false } });
    expect(() => parseManifest({ sources: [bad], wanted: [] })).toThrow(/committable/);
  });

  it('rejects a rendered fingerprint on a source that is not rendered', () => {
    const bad = source({ kind: 'pdf', rendered_pages_sha256: 'a'.repeat(64) });
    expect(() => parseManifest({ sources: [bad], wanted: [] })).toThrow(/only for edgar_html/);
  });

  it('rejects non-https URLs, malformed ids and malformed hashes', () => {
    for (const bad of [
      source({ url: 'http://www.sec.gov/x.htm' }),
      source({ id: 'Has Spaces' }),
      source({ sha256: 'not-a-hash' }),
    ]) {
      expect(() => parseManifest({ sources: [bad], wanted: [] })).toThrow();
    }
  });
});

describe('updateSource', () => {
  it('updates only the named source and returns a new manifest', () => {
    const manifest = parseManifest({
      sources: [source(), source({ id: 'other-lpa' })],
      wanted: [],
    }) as Manifest;
    const next = updateSource(manifest, 'other-lpa', { sha256: 'b'.repeat(64) });
    expect(next.sources.map((s) => s.sha256)).toEqual([null, 'b'.repeat(64)]);
    expect(manifest.sources[1]?.sha256).toBeNull();
  });
});
