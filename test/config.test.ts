import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('requires LLM_MODEL so a missing model fails at startup, not on the first request', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ LLM_MODEL: '   ' })).toThrow(/LLM_MODEL/);
  });

  it('defaults PORT to 3000', () => {
    expect(loadConfig({ LLM_MODEL: 'some-model' }).port).toBe(3000);
  });

  it('rejects a malformed PORT instead of falling back silently', () => {
    expect(() => loadConfig({ LLM_MODEL: 'm', PORT: '-1' })).toThrow(/PORT/);
    expect(() => loadConfig({ LLM_MODEL: 'm', PORT: '3000abc' })).toThrow(/PORT/);
  });
});

describe('env.example', () => {
  const example = readFileSync(path.join(import.meta.dirname, '..', 'env.example'), 'utf8');
  const settings = new Map(
    example
      .split('\n')
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => {
        const [key, ...rest] = line.split('=');
        return [key, rest.join('=')] as const;
      }),
  );

  it('parses with loadConfig once LLM_MODEL is filled in', () => {
    const env = Object.fromEntries(settings);
    expect(env.LLM_MODEL).toBe('');
    const config = loadConfig({ ...env, LLM_MODEL: 'm' });
    expect(config.port).toBe(Number(settings.get('PORT')));
  });

  it('lists no upload settings the code never reads', () => {
    expect(example).not.toMatch(/UPLOAD|MAX_FILE_SIZE/);
  });

  it('lists no vector-store settings the code never reads', () => {
    expect(example).not.toMatch(/CHROMA|PINECONE|VECTOR_STORE_TYPE/);
  });

  it('keeps values on their own line (no inline comments that end up in the value)', () => {
    for (const [key, value] of settings) {
      expect(value, key).not.toMatch(/\s#/);
    }
  });
});
