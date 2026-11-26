import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';

const testConfig: AppConfig = { port: 0, llmModel: 'test-model' };

describe('createApp', () => {
  it('answers the health check', async () => {
    const res = await request(createApp(testConfig)).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
  });

  it('does not serve uploaded files publicly', async () => {
    const res = await request(createApp(testConfig)).get('/uploads/anything.pdf');
    expect(res.status).toBe(404);
  });
});
