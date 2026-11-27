/**
 * Try hybrid retrieval from the command line (one embedding call per query, ~$0.000001).
 *
 *   npm run search -- "management fee"
 *   npm run search -- --doc ocv-fund-i-lpa-2018 --k 5 "carried interest"
 *   npm run search -- --keyword-only "key person"
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { connect } from '../src/db/client.js';
import { documents } from '../src/db/schema.js';
import { openAiEmbedder } from '../src/retrieval/embeddings.js';
import { hybridSearch } from '../src/retrieval/hybrid.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    doc: { type: 'string' },
    k: { type: 'string', default: '5' },
    'keyword-only': { type: 'boolean', default: false },
  },
});
const text = positionals.join(' ').trim();
const databaseUrl = process.env.DATABASE_URL;
if (!text || !databaseUrl) {
  console.error('usage: npm run search -- [--doc <source id>] [--k 5] [--keyword-only] <query>');
  process.exit(1);
}

const handle = connect(databaseUrl);
try {
  let documentId: string | undefined;
  if (values.doc) {
    const [doc] = await handle.db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.sourceId, values.doc));
    if (!doc) throw new Error(`no ingested document with source id ${values.doc}`);
    documentId = doc.id;
  }

  let embedding: number[] | undefined;
  if (!values['keyword-only']) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set; pass --keyword-only');
    [embedding] = (await openAiEmbedder({ apiKey }).embed([text])).vectors;
  }

  const hits = await hybridSearch(handle.db, {
    text,
    ...(embedding ? { embedding } : {}),
    ...(documentId ? { documentId } : {}),
    k: Number(values.k),
  });
  for (const hit of hits) {
    const pages =
      hit.pageStart === hit.pageEnd ? `p${hit.pageStart}` : `pp${hit.pageStart}-${hit.pageEnd}`;
    console.log(
      `${hit.score.toFixed(4)} kw=${hit.keywordRank ?? '-'} vec=${hit.vectorRank ?? '-'} ` +
        `${pages} §${hit.sectionRefs.join(',') || '-'} ${hit.sectionTitle.slice(0, 50)}`,
    );
    console.log(`    ${hit.text.replace(/\s+/g, ' ').slice(0, 160)}…`);
  }
} finally {
  await handle.close();
}
