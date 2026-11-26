export interface AppConfig {
  port: number;
  llmModel: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function parsePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

/** Read and validate configuration once at startup, so a bad setting fails fast. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const llmModel = env.LLM_MODEL?.trim();
  if (!llmModel) {
    throw new ConfigError('LLM_MODEL is required (see env.example)');
  }
  return {
    port: parsePositiveInt('PORT', env.PORT, 3000),
    llmModel,
  };
}
