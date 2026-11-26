import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp(config);

app.listen(config.port, () => {
  console.log(`RAG Backend Service running on port ${config.port}`);
  console.log(`Health check: http://localhost:${config.port}/health`);
});
