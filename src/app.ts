import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import type { AppConfig } from './config.js';

// The config parameter is unused until Phase 2 adds routes that need it; keeping it means
// server.ts and the tests don't change shape when they arrive.
export function createApp(_config: AppConfig): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
  });

  app.use(errorHandler);
  return app;
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
};
