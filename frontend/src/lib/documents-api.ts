import { createClient } from "@/lib/supabase/client";

export interface DocumentSummary {
  filename: string;
  original_filename: string;
  chunks_count: number;
  created_at: string;
}

export interface SearchResultChunk {
  id: string;
  filename: string;
  original_filename: string;
  chunk_index: number;
  chunk_text: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

export interface UploadResponse {
  success: boolean;
  filename: string;
  chunks_created: number;
}

export interface DeleteDocumentResponse {
  success: boolean;
  filename: string;
  deleted_chunks: number;
}

export interface ListDocumentsResponse {
  success: boolean;
  documents: DocumentSummary[];
}

export interface SearchDocumentsResponse {
  success: boolean;
  results: SearchResultChunk[];
}

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Resolves the backend base URL.
 * Priority: NEXT_PUBLIC_API_URL -> NEXT_PUBLIC_BACKEND_URL -> http://localhost:3001
 */
export function getApiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  }
  if (process.env.NEXT_PUBLIC_BACKEND_URL) {
    return process.env.NEXT_PUBLIC_BACKEND_URL.replace(/\/$/, "");
  }
  return "http://localhost:3001";
}

/**
 * Obtains the current Supabase access token for the authenticated user.
 * Throws if no active session exists.
 */
async function getAuthToken(): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getSession();

  if (error || !data?.session?.access_token) {
    throw new Error("Authentication required. Please sign in to continue.");
  }

  return data.session.access_token;
}

/**
 * Helper to parse backend error responses safely.
 */
async function extractErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    if (data && typeof data === "object") {
      if (typeof data.message === "string") return data.message;
      if (Array.isArray(data.message) && data.message.length > 0) {
        return data.message.join(", ");
      }
      if (typeof data.error === "string") return data.error;
    }
  } catch {
    // If not valid JSON, use fallback with HTTP status
  }
  return `${fallback} (HTTP ${response.status})`;
}

/**
 * Fetch list of documents for the authenticated client.
 */
export async function listDocuments(): Promise<DocumentSummary[]> {
  const token = await getAuthToken();
  const baseUrl = getApiBaseUrl();

  const response = await fetch(`${baseUrl}/api/documents`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorMsg = await extractErrorMessage(
      response,
      "Failed to retrieve documents"
    );
    throw new Error(errorMsg);
  }

  const data: ListDocumentsResponse = await response.json();
  return data.documents || [];
}

/**
 * Upload a PDF document for chunking and embedding.
 */
export async function uploadDocument(file: File): Promise<UploadResponse> {
  if (!file) {
    throw new Error("Please select a file to upload.");
  }

  // Client-side validation matching backend constraints
  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    throw new Error("Only PDF files are supported.");
  }

  if (file.size > MAX_FILE_SIZE) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `File size (${sizeMb} MB) exceeds the maximum allowed limit of 5 MB.`
    );
  }

  const token = await getAuthToken();
  const baseUrl = getApiBaseUrl();

  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${baseUrl}/api/documents/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      // Note: Do not set Content-Type header; browser sets multipart/form-data with boundary automatically
    },
    body: formData,
  });

  if (!response.ok) {
    const errorMsg = await extractErrorMessage(
      response,
      "Failed to upload document"
    );
    throw new Error(errorMsg);
  }

  const data: UploadResponse = await response.json();
  return data;
}

/**
 * Delete a document and all its chunks by stored filename.
 */
export async function deleteDocument(filename: string): Promise<DeleteDocumentResponse> {
  if (!filename) {
    throw new Error("Filename is required for deletion.");
  }

  const token = await getAuthToken();
  const baseUrl = getApiBaseUrl();

  const encodedFilename = encodeURIComponent(filename);
  const response = await fetch(`${baseUrl}/api/documents/${encodedFilename}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Document not found or already deleted.");
    }
    const errorMsg = await extractErrorMessage(
      response,
      "Failed to delete document"
    );
    throw new Error(errorMsg);
  }

  const data: DeleteDocumentResponse = await response.json();
  return data;
}

/**
 * Perform semantic similarity search against the client's knowledge base chunks.
 */
export async function searchDocuments(
  query: string,
  matchCount = 5,
  matchThreshold = 0.7
): Promise<SearchResultChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Please enter a search query.");
  }

  const token = await getAuthToken();
  const baseUrl = getApiBaseUrl();

  const response = await fetch(`${baseUrl}/api/documents/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: trimmed,
      match_count: matchCount,
      match_threshold: matchThreshold,
    }),
  });

  if (!response.ok) {
    const errorMsg = await extractErrorMessage(
      response,
      "Failed to execute semantic search"
    );
    throw new Error(errorMsg);
  }

  const data: SearchDocumentsResponse = await response.json();
  return data.results || [];
}
