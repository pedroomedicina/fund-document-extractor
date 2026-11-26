import { readFileSync, writeFileSync } from 'node:fs';
import { Schema } from 'effect';

/** Document types the classifier distinguishes (Phase 2). */
export const DocumentType = Schema.Literals([
  'lpa',
  'lpa_term_sheet',
  'side_letter',
  'capital_call_notice',
  'distribution_notice',
  'capital_call_and_distribution_notice',
  'subscription_agreement',
  'safe',
  'other',
]);
export type DocumentType = typeof DocumentType.Type;

const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

export const License = Schema.Struct({
  /** Plain-language summary of what the source's terms allow, with where they were read. */
  summary: Schema.String,
  /** The original file may be committed to this public repo. */
  may_commit: Schema.Boolean,
  /** The document (file, page images or quoted passages) may be shown on the public demo. */
  public_demo: Schema.Boolean,
});

export const Source = Schema.Struct({
  /** Stable, human-readable id. Never reuse or rename after gold labels reference it. */
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  title: Schema.String,
  publisher: Schema.String,
  url: Schema.String.check(Schema.isPattern(/^https:\/\//)),
  /** How the file arrives. EDGAR HTML is rendered to PDF before ingestion. */
  kind: Schema.Literals(['edgar_html', 'pdf']),
  expected_type: DocumentType,
  /**
   * Documents built from the same template share a family (the ILPA model LPA and an LPA
   * drafted from it). Eval results are reported per family so one template can't dominate.
   */
  template_family: Schema.String,
  license: License,
  /** sha256 of the downloaded bytes; null until the first `corpus:fetch --record`. */
  sha256: Schema.NullOr(Sha256),
  /**
   * sha256 of the rendered PDF's per-page text (EDGAR HTML only), from pagesFingerprint().
   * Not the PDF bytes: Chromium stamps a creation date, so bytes change on every render.
   * Gold labels pin this hash; if it changes, page numbers may have moved.
   */
  rendered_pages_sha256: Schema.NullOr(Sha256),
  notes: Schema.optionalKey(Schema.String),
});
export type Source = typeof Source.Type;

export const Wanted = Schema.Struct({
  description: Schema.String,
  why: Schema.String,
  blocker: Schema.String,
});

export const Manifest = Schema.Struct({
  sources: Schema.Array(Source),
  wanted: Schema.Array(Wanted),
});
export type Manifest = typeof Manifest.Type;

export class ManifestError extends Error {
  override name = 'ManifestError';
}

/** Parse and check a manifest: schema, unique ids, and rendered hashes only where rendering happens. */
export function parseManifest(json: unknown): Manifest {
  const manifest = Schema.decodeUnknownSync(Manifest)(json);
  const seen = new Set<string>();
  for (const source of manifest.sources) {
    if (seen.has(source.id)) throw new ManifestError(`duplicate source id: ${source.id}`);
    seen.add(source.id);
    if (source.kind !== 'edgar_html' && source.rendered_pages_sha256 !== null) {
      throw new ManifestError(`${source.id}: rendered_pages_sha256 is only for edgar_html sources`);
    }
    if (source.license.may_commit && !source.license.public_demo) {
      throw new ManifestError(`${source.id}: a committable file must also be allowed on the demo`);
    }
  }
  return manifest;
}

export function readManifest(path: string): Manifest {
  return parseManifest(JSON.parse(readFileSync(path, 'utf8')));
}

export function writeManifest(path: string, manifest: Manifest): void {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Return a copy of the manifest with one source's fields updated. */
export function updateSource(
  manifest: Manifest,
  id: string,
  patch: Partial<Pick<Source, 'sha256' | 'rendered_pages_sha256'>>,
): Manifest {
  return {
    ...manifest,
    sources: manifest.sources.map((source) =>
      source.id === id ? { ...source, ...patch } : source,
    ),
  };
}
