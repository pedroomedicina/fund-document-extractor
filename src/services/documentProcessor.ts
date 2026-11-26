import fs from 'node:fs';
import path from 'node:path';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
// Import the library entry directly: pdf-parse's index.js runs a self-test that reads a
// missing file whenever it is loaded as an ES module (module.parent is undefined).
import pdf from 'pdf-parse/lib/pdf-parse.js';

export class DocumentProcessor {
  private textSplitter: RecursiveCharacterTextSplitter;

  constructor() {
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
  }

  async processDocument(
    filePath: string,
    filename: string,
  ): Promise<{ content: string; chunks: string[] }> {
    const fileExtension = path.extname(filename).toLowerCase();

    let content: string;

    if (fileExtension === '.pdf') {
      content = await this.extractTextFromPDF(filePath);
    } else if (fileExtension === '.txt') {
      content = await this.extractTextFromTXT(filePath);
    } else {
      throw new Error(`Unsupported file type: ${fileExtension}`);
    }

    const chunks = await this.textSplitter.splitText(content);

    return { content, chunks };
  }

  private async extractTextFromPDF(filePath: string): Promise<string> {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    return data.text;
  }

  private async extractTextFromTXT(filePath: string): Promise<string> {
    return fs.readFileSync(filePath, 'utf-8');
  }
}
