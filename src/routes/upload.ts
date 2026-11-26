import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import type { AppConfig } from '../config.js';
import { DocumentProcessor } from '../services/documentProcessor.js';
import { VectorStoreService } from '../services/vectorStore.js';
import type { UploadResponse } from '../types/index.js';

export const ALLOWED_EXTENSIONS = ['.pdf', '.txt'] as const;

export class UnsupportedFileTypeError extends Error {
  override name = 'UnsupportedFileTypeError';
  constructor(extension: string) {
    super(
      `Unsupported file type "${extension || '(none)'}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
    );
  }
}

export function uploadRoutes(config: AppConfig): express.Router {
  const router = express.Router();
  let documentProcessor: DocumentProcessor | undefined;

  const upload = multer({
    storage: multer.diskStorage({
      destination: config.uploadDir,
      filename: (_req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
      },
    }),
    fileFilter: (_req, file, cb) => {
      const extension = path.extname(file.originalname).toLowerCase();
      if ((ALLOWED_EXTENSIONS as readonly string[]).includes(extension)) {
        cb(null, true);
      } else {
        cb(new UnsupportedFileTypeError(extension));
      }
    },
    limits: { fileSize: config.maxFileSize },
  });

  router.post(
    '/',
    (_req, res, next) => {
      if (!config.allowUploads) {
        res
          .status(403)
          .json({ success: false, message: 'Uploads are disabled on this deployment' });
        return;
      }
      next();
    },
    upload.single('document'),
    async (req, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ success: false, message: 'No file uploaded' });
          return;
        }

        const documentId = uuidv4();
        const filename = req.file.originalname;
        documentProcessor ??= new DocumentProcessor();
        const { chunks } = await documentProcessor.processDocument(req.file.path, filename);

        await VectorStoreService.getInstance().addDocumentChunks(documentId, chunks, {
          filename: req.file.filename,
          originalName: filename,
        });

        const response: UploadResponse = {
          success: true,
          documentId,
          filename,
          chunks: chunks.length,
          message: `Document processed successfully. Created ${chunks.length} chunks.`,
        };
        res.json(response);
      } catch (error) {
        console.error('Upload processing error:', error);
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Failed to process document',
        });
      }
    },
  );

  return router;
}
