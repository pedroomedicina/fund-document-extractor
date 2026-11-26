/**
 * Download every source in corpus/sources.json into corpus/raw/ and verify its sha256.
 *
 *   npm run corpus:fetch                 verify pinned hashes; fail on unrecorded or changed files
 *   npm run corpus:fetch -- --record     also pin hashes for sources that have none yet
 *   npm run corpus:fetch -- --only a,b   limit to these source ids
 *
 * sec.gov requests need EDGAR_USER_AGENT in .env ("Your Name your@email").
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  checkHash,
  download,
  FetchError,
  Pacer,
  rawFileName,
  SEC_MIN_INTERVAL_MS,
} from '../src/corpus/fetch.js';
import { readManifest, updateSource, writeManifest } from '../src/corpus/manifest.js';

const MANIFEST = 'corpus/sources.json';
const RAW_DIR = 'corpus/raw';

const { values } = parseArgs({
  options: {
    record: { type: 'boolean', default: false },
    only: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
});
const only = values.only ? new Set(values.only.split(',').map((id) => id.trim())) : null;

let manifest = readManifest(MANIFEST);
mkdirSync(RAW_DIR, { recursive: true });
const deps = {
  fetch,
  secPacer: new Pacer(SEC_MIN_INTERVAL_MS),
  edgarUserAgent: process.env.EDGAR_USER_AGENT,
};

const problems: string[] = [];
for (const source of manifest.sources) {
  if (only && !only.has(source.id)) continue;
  const target = path.join(RAW_DIR, rawFileName(source));

  // A file already on disk with the pinned hash needs no download.
  if (!values.force && source.sha256 && existsSync(target)) {
    if (checkHash(source.sha256, readFileSync(target)).status === 'match') {
      console.log(`ok       ${source.id} (cached)`);
      continue;
    }
  }

  let bytes: Uint8Array;
  try {
    bytes = await download(source.url, deps);
  } catch (error) {
    const message = error instanceof FetchError ? error.message : String(error);
    problems.push(`${source.id}: ${message}`);
    console.error(`FAILED   ${source.id}: ${message}`);
    continue;
  }

  const check = checkHash(source.sha256, bytes);
  if (check.status === 'mismatch') {
    // Never overwrite: a changed source can move pages under existing gold labels.
    problems.push(
      `${source.id}: content changed (expected ${check.expected}, got ${check.actual})`,
    );
    console.error(`CHANGED  ${source.id}: not written; inspect before re-pinning`);
    continue;
  }
  writeFileSync(target, bytes);
  if (check.status === 'match') {
    console.log(`ok       ${source.id} (${bytes.length} bytes)`);
  } else if (values.record) {
    manifest = updateSource(manifest, source.id, { sha256: check.actual });
    console.log(`recorded ${source.id} sha256=${check.actual}`);
  } else {
    problems.push(`${source.id}: no pinned sha256 (re-run with --record to pin ${check.actual})`);
    console.error(`UNPINNED ${source.id}`);
  }
}

if (values.record) writeManifest(MANIFEST, manifest);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
