# RAG Backend Service

> **In progress:** this service is being rebuilt into a fund-document extractor (LPAs to typed, page-cited data). The sections below the Development notes describe the original RAG demo and will be rewritten. Design decisions: [docs/decisions/](docs/decisions/README.md).

## Development

Requires Node 22+ and Docker.

```bash
npm ci
docker compose up -d db          # Postgres 17 + pgvector on localhost:5433
npx playwright install chromium  # for EDGAR rendering and PDF test fixtures
cp env.example .env              # then fill in LLM_MODEL and keys
npm run db:migrate
```

| Command                 | What it does                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `npm run lint`          | Biome lint and format check                                                           |
| `npm run typecheck`     | `tsc --noEmit`                                                                        |
| `npm test`              | Vitest: unit tests plus integration tests against `DATABASE_URL_TEST`                 |
| `npm run test:ci`       | Same, and fails if any test was skipped                                               |
| `npm run corpus:fetch`  | Download the public corpus listed in `corpus/sources.json` (needs `EDGAR_USER_AGENT`) |
| `npm run corpus:render` | Render EDGAR HTML to PDF and check printed page numbers                               |
| `npm run db:generate`   | Generate a migration after editing `src/db/schema.ts`                                 |

Tests written with `knownBug()` describe the correct behaviour for a defect listed in [docs/known-bugs.md](docs/known-bugs.md). They are expected to fail: when a fix lands, the test passes, the suite fails, and the fix changes `knownBug` to `it` in the same commit.

A Node.js TypeScript backend service for Retrieval-Augmented Generation (RAG) that processes documents, creates embeddings, and provides AI-powered question answering.

## 🚀 Features

- **Document Processing**: Upload and process PDF and TXT files
- **Text Chunking**: Intelligent text splitting with overlap for better context
- **Vector Storage**: In-memory vector store with OpenAI embeddings and cosine similarity search
- **AI Integration**: OpenAI embeddings and chat completions for accurate question answering
- **Real-time Processing**: Immediate document processing and querying
- **REST API**: Clean HTTP endpoints for document upload and Q&A

## 📁 Project Structure

```
rag-backend-service/
├── env.example          # 🔧 Configuration template
├── package.json         # 📦 Dependencies & scripts  
├── tsconfig.json        # ⚙️ TypeScript configuration
├── README.md            # 📖 Project documentation
├── uploads/             # 📂 File storage directory
├── dist/                # 🏗️ Compiled JavaScript (auto-generated)
└── src/
    ├── server.ts        # 🚀 Main Express server
    ├── types/index.ts   # 📝 TypeScript interfaces
    ├── routes/
    │   ├── upload.ts    # 📤 File upload endpoint
    │   └── qa.ts        # ❓ Question-answering endpoint
    └── services/
        ├── documentProcessor.ts  # 📄 PDF/TXT processing service
        └── vectorStore.ts        # 🧠 In-memory vector store with embeddings
```

## 🎯 File Descriptions

### **Core Server Files**

#### `src/server.ts` - Main Express Server

- **Purpose**: Central web server with middleware configuration
- **Features**:
  - CORS enabled for cross-origin requests
  - Uploaded files stay private (not served back)
  - Global error handling
  - Health check endpoint
  - Lazy service initialization for proper environment loading
- **Endpoints**:
  - `GET /health` - Server health check
  - `POST /api/upload` - Document upload (expects 'document' field)
  - `POST /api/qa` - Question answering
- **Status**: ✅ Complete and working

#### `src/types/index.ts` - TypeScript Definitions

- **Purpose**: Type safety and interface definitions
- **Defines**:
  - `DocumentMetadata` - File information and metadata
  - `Chunk` - Text chunk with embeddings and metadata
  - `QAResponse` - Question-answer response format
  - `UploadResponse` - File upload response format
- **Status**: ✅ Complete and working

### **API Routes**

#### `src/routes/upload.ts` - Document Upload Handler

- **Purpose**: Handle file uploads and document processing
- **Features**:
  - Multer configuration for file handling
  - File type validation (PDF, TXT only)
  - File size limits (configurable via env, default 10MB)
  - Unique document ID generation using UUID
  - Automatic text extraction, chunking, and vector storage
  - Singleton vector store for consistent data persistence
- **Process Flow**:
  1. Validate uploaded file (expects 'document' field)
  2. Generate unique document ID
  3. Extract text content using DocumentProcessor
  4. Split into chunks and generate embeddings
  5. Store in in-memory vector database
  6. Return processing results with chunk count
- **Status**: ✅ Complete and working

#### `src/routes/qa.ts` - Question Answering Handler

- **Purpose**: Process user questions and return AI-generated answers
- **Features**:
  - Input validation for query strings
  - Vector similarity search using cosine similarity
  - OpenAI chat model set by `LLM_MODEL` for answer generation
  - Context-aware responses with source attribution
  - Comprehensive error handling and debugging
- **Process Flow**:
  1. Validate user query
  2. Convert query to embedding using OpenAI
  3. Search in-memory vector store for relevant chunks
  4. Generate AI response with retrieved context
  5. Return answer with source chunks and similarity scores
- **Status**: ✅ Complete and working

### **Services**

#### `src/services/documentProcessor.ts` - Document Processing Service

- **Purpose**: Extract and chunk text from uploaded documents
- **Features**:
  - PDF text extraction using `pdf-parse`
  - TXT file reading with proper encoding
  - LangChain RecursiveCharacterTextSplitter with configurable settings
  - Support for multiple file formats
- **Configuration**:
  - Chunk size: 1000 characters
  - Chunk overlap: 200 characters
- **Status**: ✅ Complete and working

#### `src/services/vectorStore.ts` - In-Memory Vector Store Service

- **Purpose**: Store document chunks with embeddings and provide similarity search
- **Features**:
  - Singleton pattern for data persistence across requests
  - OpenAI text-embedding-3-small for vector generation
  - Cosine similarity calculation for chunk retrieval
  - In-memory storage with full CRUD operations
  - Comprehensive debugging and logging
- **Key Methods**:
  - `addDocumentChunks()` - Store processed document chunks with embeddings
  - `searchSimilarChunks()` - Find relevant chunks using vector similarity
  - `deleteDocument()` - Remove all chunks for a specific document
  - `getCollectionInfo()` - Get statistics about stored documents
- **Status**: ✅ Complete and working

### **Configuration Files**

#### `env.example` - Environment Configuration Template

- **Purpose**: Template for required environment variables
- **Required Variables**:
  - **OpenAI**: API key for embeddings and completions
  - **Server**: Port and environment settings
  - **File Upload**: Size limits and upload directory
- **Status**: ✅ Complete

#### `tsconfig.json` - TypeScript Configuration

- **Purpose**: TypeScript compiler settings
- **Features**:
  - ES2020 target for modern JavaScript
  - CommonJS modules for Node.js compatibility
  - Strict type checking enabled
  - Source maps for debugging
  - Separate source (`src/`) and output (`dist/`) directories
- **Status**: ✅ Complete

#### `package.json` - Project Dependencies

- **Scripts**:
  - `npm run build` - Compile TypeScript to JavaScript
  - `npm run dev` - Run development server with tsx (watch mode)
  - `npm start` - Run compiled production server
- **Key Dependencies**:
  - **Express**: Web framework
  - **LangChain**: AI/ML toolkit for text processing and chunking
  - **OpenAI**: AI model integration (embeddings + chat completions)
  - **Multer**: File upload handling
  - **PDF-Parse**: PDF text extraction
  - **UUID**: Unique document ID generation

## 🚦 Current Implementation Status

### ✅ **Fully Working Components**

- ✅ File upload system (PDF/TXT support)
- ✅ Text extraction from documents
- ✅ Intelligent text chunking with overlap
- ✅ **OpenAI embedding generation**
- ✅ **In-memory vector storage with singleton pattern**
- ✅ **Vector similarity search using cosine similarity**
- ✅ **AI answer generation with context from retrieved chunks**
- ✅ **Complete RAG pipeline from upload to Q&A**
- ✅ REST API endpoints with proper error handling
- ✅ TypeScript compilation and type safety
- ✅ Express server with middleware and CORS
- ✅ Comprehensive debugging and logging
- ✅ Document metadata storage and management

### 🚧 **Future Enhancements**

- Persistent vector storage (PostgreSQL with pgvector, Pinecone, etc.)
- Response streaming implementation
- Multiple vector store backends
- Advanced filtering and search options
- User authentication and authorization
- Rate limiting and caching
- Batch document processing
- Document versioning and updates

## 📊 RAG Architecture Flow

```
1. Document Upload (PDF/TXT) ✅
   ↓
2. Text Extraction (pdf-parse/fs) ✅
   ↓  
3. Text Chunking (LangChain RecursiveCharacterTextSplitter) ✅
   ↓
4. Generate Embeddings (OpenAI text-embedding-3-small) ✅
   ↓
5. Store in In-Memory Vector Store (Cosine Similarity) ✅
   ↓
6. User Query → Embedding → Similarity Search ✅
   ↓
7. Retrieve Relevant Chunks with Scores ✅
   ↓
8. Generate AI Answer (`LLM_MODEL` + Context) ✅
   ↓
9. Return Response with Sources to Client ✅
```

## 🚀 Getting Started

### **Prerequisites**

- Node.js 18+ and npm
- OpenAI API key

### **Installation & Setup**

1. **Clone and install dependencies:**

   ```bash
   git clone <repository-url>
   cd rag-backend-service
   npm install
   ```

2. **Set up environment variables:**

   ```bash
   cp env.example .env
   # Edit .env and add your OpenAI API key
   ```

3. **Start the development server:**

   ```bash
   npm run dev
   ```

   The server will start on `http://localhost:3000`

### **Testing the API**

1. **Health check:**

   ```bash
   curl http://localhost:3000/health
   ```

2. **Upload a document:**

   ```bash
   curl -X POST http://localhost:3000/api/upload \
     -F "document=@your-file.pdf"
   ```

3. **Ask questions about the uploaded document:**

   ```bash
   curl -X POST http://localhost:3000/api/qa \
     -H "Content-Type: application/json" \
     -d '{"query": "What is the main topic of the document?"}'
   ```

### **Example API Responses**

**Successful Upload:**

```json
{
  "success": true,
  "documentId": "123e4567-e89b-12d3-a456-426614174000",
  "filename": "sample.txt",
  "chunks": 3,
  "message": "Document processed successfully. Created 3 chunks."
}
```

**Q&A Response:**

```json
{
  "answer": "The document discusses artificial intelligence and machine learning concepts...",
  "sources": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000-chunk-0",
      "content": "Sample content from the document...",
      "metadata": {
        "documentId": "123e4567-e89b-12d3-a456-426614174000",
        "chunkIndex": 0,
        "startIndex": 0,
        "endIndex": 245
      },
      "score": 0.8742
    }
  ],
  "query": "What is the main topic of the document?"
}
```

## 🧪 Testing Strategy

### **Manual Testing**

1. **Health Check**: `GET /health` → Should return `{"status": "OK"}`
2. **Document Upload**: Test with PDF and TXT files
3. **Q&A Functionality**: Ask various questions about uploaded content
4. **Error Handling**: Test with invalid files, malformed requests

### **Test Files**

Create test files to verify functionality:

- `test-sample.txt` - Simple text document with AI/ML content
- `test-document.pdf` - PDF with readable text content

### **Expected Behavior**

- Documents are processed and chunked automatically
- Similar questions should return relevant content from uploaded documents
- Unrelated questions should indicate no relevant information found
- Similarity scores help identify relevance confidence

## 📚 Business Use Cases

- **Document Q&A Systems**: Ask questions about uploaded documents
- **Knowledge Base Search**: Semantic search through document collections
- **Content Analysis**: Extract insights from large document sets
- **Research Assistance**: AI-powered document comprehension
- **Customer Support**: Automated responses based on documentation
- **Educational Tools**: Interactive learning from textbooks/papers
- **Legal Document Review**: Query-based document analysis
- **Technical Documentation**: AI-assisted troubleshooting guides

## 🔧 Environment Variables

Create a `.env` file with the following variables:

```env
# OpenAI Configuration (Required)
OPENAI_API_KEY=your_openai_api_key_here

# Server Configuration
PORT=3000
NODE_ENV=development

# File Upload Configuration
MAX_FILE_SIZE=10485760  # 10MB in bytes
UPLOAD_DIR=./uploads
```

## 🔍 Debugging and Monitoring

The application includes comprehensive logging for debugging:

- **Upload Process**: Document processing, chunking, and embedding generation
- **Vector Search**: Similarity scores and chunk retrieval details
- **Q&A Pipeline**: Query processing and context assembly
- **Error Handling**: Detailed error messages and stack traces

View logs in the console when running `npm run dev` to monitor system behavior.

## 🏗️ Architecture Notes

- **In-Memory Storage**: Current implementation uses memory for vector storage, suitable for development and small-scale use
- **Singleton Pattern**: Ensures data persistence across API calls within the same server session
- **Cosine Similarity**: Mathematical approach for finding semantically similar content
- **Lazy Initialization**: Services are created only when needed to ensure proper environment loading
- **Type Safety**: Full TypeScript implementation with comprehensive interfaces

For production use, consider migrating to persistent vector storage solutions like PostgreSQL with pgvector extension or cloud-based vector databases.
