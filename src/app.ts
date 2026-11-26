import fs from 'node:fs';
import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import type { AppConfig } from './config.js';
import { qaRoutes } from './routes/qa.js';
import { UnsupportedFileTypeError, uploadRoutes } from './routes/upload.js';

export function createApp(config: AppConfig): express.Express {
  // Multer writes into this directory; create it up front instead of failing on the first upload.
  fs.mkdirSync(config.uploadDir, { recursive: true });

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Uploaded files are private inputs to the pipeline and are never served back.
  app.use('/api/upload', uploadRoutes(config));
  app.use('/api/qa', qaRoutes(config));

  app.get('/health', (_req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
  });

  app.use(errorHandler);
  return app;
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than the allowed maximum' : err.message;
    res.status(400).json({ error: message, code: err.code });
    return;
  }
  if (err instanceof UnsupportedFileTypeError) {
    res.status(400).json({ error: err.message, code: 'UNSUPPORTED_FILE_TYPE' });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
};
