# Phase 2 — Document Ingestion & RAG Semantic Search Pipeline

## 1. Overview
Phase 2 establishes the end-to-end Knowledge Base system for the Voice AI Agent Platform. Clients upload business documentation (company policies, FAQs, product sheets, guides) in PDF format. The backend ingests, parses, chunks, and computes 1536-dimensional vector embeddings, storing them in Supabase PostgreSQL via `pgvector`. During telephone or text conversations, the AI agent retrieves relevant document passages via semantic similarity search to answer caller questions with high accuracy.

---

## 2. Architecture & Pipeline Flow

```
+-----------------------------------------------------------------------------------------+
|                                    Frontend (Next.js)                                   |
|   /dashboard/documents                                                                 |
|   - PDF Upload Dropzone (Max 5 MB, PDF only)                                            |
|   - Document Listing Table (Original filename, chunk count, upload timestamp)           |
|   - Deletion Confirmation Dialog                                                        |
|   - Semantic Search Playground (Real-time query testing & similarity score preview)    |
+-----------------------------------------------------------------------------------------+
                                          |
                      Authorization: Bearer <Supabase JWT>
                                          v
+-----------------------------------------------------------------------------------------+
|                                    Backend (NestJS)                                     |
|   DocumentsController & DocumentsService                                                |
|                                                                                         |
|   1. Authentication & Tenant Isolation:                                                 |
|      - Authenticated client_id resolved from JWT via Supabase Auth                      |
|      - Body/query client_id parameters strictly ignored to prevent spoofing             |
|                                                                                         |
|   2. Document Ingestion Pipeline:                                                       |
|      - PDF Parsing (pdf-parse) with OCR fallback (tesseract.js)                         |
|      - Text sanitization (Unicode normalization, whitespace clean)                      |
|      - Sliding window chunking (400 words per chunk, 50-word overlap)                   |
|      - OpenAI text-embedding-3-small (1536 dims, exponential backoff retries)           |
|                                                                                         |
|   3. Endpoints:                                                                         |
|      - POST   /api/documents/upload  -> Ingests, embeds, stores chunks                  |
|      - GET    /api/documents         -> Aggregates documents by client_id               |
|      - DELETE /api/documents/:file   -> Cascading chunk deletion for client_id          |
|      - POST   /api/documents/search  -> Executes match_documents RPC                    |
+-----------------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------------+
|                               Database (Supabase PostgreSQL)                            |
|   - Extension: pgvector                                                                 |
|   - Table: public.document_chunks (client_id, filename, chunk_text, embedding, etc.)    |
|   - Indexes: client_id, filename, created_at, HNSW vector cosine index                  |
|   - Row Level Security: Enforced for authenticated clients                              |
|   - RPC: public.match_documents(query_embedding, match_client_id, count, threshold)    |
+-----------------------------------------------------------------------------------------+
```

---

## 3. API Specifications

### `POST /api/documents/upload`
- **Authentication:** Required (`Authorization: Bearer <token>`)
- **Content-Type:** `multipart/form-data`
- **Body:** `file` (PDF file, max 5 MB)
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "chunks_created": 8,
    "filename": "1789213777936_policy.pdf"
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Missing file, unsupported file format, or unreadable PDF text.
  - `401 Unauthorized`: Missing or invalid bearer token.
  - `413 Payload Too Large`: File exceeds 5 MB.
  - `500 Internal Server Error`: Sanitized processing error.

### `GET /api/documents`
- **Authentication:** Required (`Authorization: Bearer <token>`)
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "documents": [
      {
        "filename": "1789213777936_policy.pdf",
        "original_filename": "policy.pdf",
        "chunks_count": 8,
        "created_at": "2026-09-12T11:40:00.000Z"
      }
    ]
  }
  ```

### `DELETE /api/documents/:filename`
- **Authentication:** Required (`Authorization: Bearer <token>`)
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "filename": "1789213777936_policy.pdf",
    "deleted_chunks": 8
  }
  ```
- **Error Responses:**
  - `404 Not Found`: Document does not exist or belongs to another tenant.

### `POST /api/documents/search`
- **Authentication:** Required (`Authorization: Bearer <token>`)
- **Content-Type:** `application/json`
- **Body:**
  ```json
  {
    "query": "What is the return window for defective items?",
    "match_count": 5,
    "match_threshold": 0.7
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "results": [
      {
        "id": "c1f7a24a-18e4-4d89-9403-24cf92c55e21",
        "filename": "1789213777936_policy.pdf",
        "original_filename": "policy.pdf",
        "chunk_index": 2,
        "chunk_text": "Returns are accepted within 30 days of purchase...",
        "similarity": 0.864,
        "metadata": {
          "word_count": 395,
          "total_chunks": 8
        }
      }
    ]
  }
  ```

---

## 4. Multi-Tenant Security & Isolation Audit

1. **Client Identity Binding:**
   - Every operation derives `clientId` strictly from `req.user.id` or `supabase.auth.getUser(token)`.
   - Any `client_id` or `clientId` in the request body or query parameter is ignored.
2. **Database Isolation:**
   - All insertions attach the caller's verified `client_id`.
   - Listing queries filter with `.eq('client_id', clientId)`.
   - Deletion queries require both `.eq('client_id', clientId).eq('filename', filename)`.
   - Vector similarity RPC filters `WHERE dc.client_id = match_client_id`.
3. **Information Disclosure Prevention:**
   - Error messages are sanitized before transmission; database connection details, OpenAI API keys, internal SQL queries, and stack traces are withheld from clients.

---

## 5. Database Schema & Vector Indexing

The complete SQL schema for Phase 2 is maintained in `frontend/supabase/schema.sql`:
- **pgvector Extension:** `CREATE EXTENSION IF NOT EXISTS vector;`
- **Table:** `public.document_chunks` with `vector(1536)` column for embeddings.
- **Index:** HNSW index on `embedding` using `vector_cosine_ops` for fast nearest neighbor search.
- **Row Level Security (RLS):** Enabled on `public.document_chunks` with policy restricting access to `auth.uid() = client_id`.
- **Stored Procedure:** `public.match_documents` with `SECURITY DEFINER` and `SET search_path = public`.
