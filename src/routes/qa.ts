import express from 'express';
import { OpenAI } from 'openai';
import type { AppConfig } from '../config.js';
import { VectorStoreService } from '../services/vectorStore.js';
import type { QAResponse } from '../types/index.js';

export function qaRoutes(config: AppConfig): express.Router {
  const router = express.Router();
  let openai: OpenAI | undefined;

  // POST /api/qa - Ask questions about uploaded documents
  router.post('/', async (req, res) => {
    try {
      const { query } = req.body ?? {};
      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Query is required and must be a string' });
        return;
      }

      const vectorStore = VectorStoreService.getInstance();
      const relevantChunks = await vectorStore.searchSimilarChunks(query, 5);

      if (relevantChunks.length === 0) {
        res.json({
          answer:
            "I couldn't find any relevant information in the uploaded documents to answer your question.",
          sources: [],
          query,
        });
        return;
      }

      const context = relevantChunks
        .map((chunk, index) => `[${index + 1}] ${chunk.content}`)
        .join('\n\n');

      const systemPrompt = `You are a helpful AI assistant that answers questions based on the provided context from uploaded documents.

Instructions:
- Use only the information provided in the context to answer questions
- If the context doesn't contain enough information to answer the question, say so
- Be concise but thorough in your responses
- Reference the source information when possible

Context:
${context}`;

      openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: config.llmModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
        // max_completion_tokens works on every current chat model, including reasoning models,
        // which reject max_tokens and a custom temperature. Reasoning tokens count toward it.
        max_completion_tokens: 1500,
      });

      const answer = completion.choices[0]?.message?.content || "I couldn't generate a response.";
      const response: QAResponse = { answer, sources: relevantChunks, query };
      res.json(response);
    } catch (error) {
      console.error('QA processing error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to process query',
      });
    }
  });

  return router;
}
