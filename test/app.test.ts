import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';

let tmpRoot: string;

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    uploadDir: path.join(tmpRoot, 'uploads'),
    maxFileSize: 1024,
    allowUploads: true,
    llmModel: 'test-model',
    ...overrides,
  };
}

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'rag-app-test-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('createApp', () => {
  it('creates the upload directory on startup', () => {
    const config = testConfig();
    expect(existsSync(config.uploadDir)).toBe(false);
    createApp(config);
    expect(existsSync(config.uploadDir)).toBe(true);
  });

  it('answers the health check', async () => {
    const res = await request(createApp(testConfig())).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
  });

  it('does not serve uploaded files publicly', async () => {
    const res = await request(createApp(testConfig())).get('/uploads/anything.pdf');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/upload errors', () => {
  it('returns 400 for a file type that is not allowed', async () => {
    const res = await request(createApp(testConfig()))
      .post('/api/upload')
      .attach('document', Buffer.from('not a pdf'), 'notes.docx');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('returns 400 for a file larger than MAX_FILE_SIZE', async () => {
    const res = await request(createApp(testConfig({ maxFileSize: 16 })))
      .post('/api/upload')
      .attach('document', Buffer.alloc(64, 'a'), 'big.txt');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LIMIT_FILE_SIZE');
  });

  it('returns 400 when the request has no file', async () => {
    const res = await request(createApp(testConfig())).post('/api/upload');
    expect(res.status).toBe(400);
  });

  it('returns 403 when uploads are disabled, before reading the file', async () => {
    const res = await request(createApp(testConfig({ allowUploads: false })))
      .post('/api/upload')
      .attach('document', Buffer.from('hello'), 'a.txt');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/qa validation', () => {
  it('returns 400 when the query is missing', async () => {
    const res = await request(createApp(testConfig())).post('/api/qa').send({});
    expect(res.status).toBe(400);
  });
});
