import path from 'node:path';

export interface AppConfig {
  port: number;
  uploadDir: string;
  maxFileSize: number;
  allowUploads: boolean;
  llmModel: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function parsePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

function parseBool(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  throw new ConfigError(`${name} must be true or false, got "${raw}"`);
}

/** Read and validate configuration once at startup, so a bad setting fails fast. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const llmModel = env.LLM_MODEL?.trim();
  if (!llmModel) {
    throw new ConfigError('LLM_MODEL is required (see env.example)');
  }
  return {
    port: parsePositiveInt('PORT', env.PORT, 3000),
    uploadDir: path.resolve(env.UPLOAD_DIR?.trim() || './uploads'),
    maxFileSize: parsePositiveInt('MAX_FILE_SIZE', env.MAX_FILE_SIZE, DEFAULT_MAX_FILE_SIZE),
    allowUploads: parseBool('ALLOW_UPLOADS', env.ALLOW_UPLOADS, true),
    llmModel,
  };
}
