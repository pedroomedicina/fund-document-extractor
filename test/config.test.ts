import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('requires LLM_MODEL so a missing model fails at startup, not on the first request', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ LLM_MODEL: '   ' })).toThrow(/LLM_MODEL/);
  });

  it('uses defaults: 10 MB upload limit, port 3000, uploads allowed', () => {
    const config = loadConfig({ LLM_MODEL: 'some-model' });
    expect(config.maxFileSize).toBe(10 * 1024 * 1024);
    expect(config.port).toBe(3000);
    expect(config.allowUploads).toBe(true);
    expect(path.isAbsolute(config.uploadDir)).toBe(true);
  });

  it('rejects malformed numbers and booleans instead of falling back silently', () => {
    expect(() => loadConfig({ LLM_MODEL: 'm', MAX_FILE_SIZE: '10MB' })).toThrow(/MAX_FILE_SIZE/);
    expect(() => loadConfig({ LLM_MODEL: 'm', PORT: '-1' })).toThrow(/PORT/);
    expect(() => loadConfig({ LLM_MODEL: 'm', ALLOW_UPLOADS: 'maybe' })).toThrow(/ALLOW_UPLOADS/);
  });

  it('parses ALLOW_UPLOADS=false for the public demo', () => {
    expect(loadConfig({ LLM_MODEL: 'm', ALLOW_UPLOADS: 'false' }).allowUploads).toBe(false);
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

  it('documents a 10 MB upload limit that loadConfig accepts', () => {
    expect(settings.get('MAX_FILE_SIZE')).toBe(String(10 * 1024 * 1024));
    const config = loadConfig({ LLM_MODEL: 'm', MAX_FILE_SIZE: settings.get('MAX_FILE_SIZE') });
    expect(config.maxFileSize).toBe(10 * 1024 * 1024);
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
