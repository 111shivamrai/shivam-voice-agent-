"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  FileText,
  UploadCloud,
  Trash2,
  Search,
  SearchX,
  Loader2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Sparkles,
  X,
} from "lucide-react";
import clsx from "clsx";
import {
  listDocuments,
  uploadDocument,
  deleteDocument,
  searchDocuments,
  MAX_FILE_SIZE,
  type DocumentSummary,
  type SearchResultChunk,
} from "@/lib/documents-api";

export default function DocumentsPage() {
  // Document Listing State
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Deletion State & Modal
  const [docToDelete, setDocToDelete] = useState<DocumentSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Semantic Search Playground State
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResultChunk[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Refresh document list
  const refreshDocuments = useCallback(async () => {
    try {
      setListLoading(true);
      setListError(null);
      const docs = await listDocuments();
      setDocuments(docs);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to load documents.";
      setListError(message);
    } finally {
      setListLoading(false);
    }
  }, []);

  // Initial load on mount without synchronous setState in effect body
  useEffect(() => {
    let isMounted = true;

    async function fetchInitialDocs() {
      try {
        const docs = await listDocuments();
        if (isMounted) {
          setDocuments(docs);
          setListError(null);
        }
      } catch (err: unknown) {
        if (isMounted) {
          const message =
            err instanceof Error ? err.message : "Failed to load documents.";
          setListError(message);
        }
      } finally {
        if (isMounted) {
          setListLoading(false);
        }
      }
    }

    fetchInitialDocs();

    return () => {
      isMounted = false;
    };
  }, []);

  // File selection & validation
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setUploadError(null);
    setUploadSuccess(null);
    const files = e.target.files;
    if (files && files.length > 0) {
      validateAndSetFile(files[0]);
    }
  }

  function validateAndSetFile(file: File) {
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setUploadError("Only PDF documents (.pdf) are accepted.");
      setSelectedFile(null);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setUploadError(
        `File size (${sizeMb} MB) exceeds the 5 MB limit. Please choose a smaller file.`
      );
      setSelectedFile(null);
      return;
    }
    setUploadError(null);
    setSelectedFile(file);
  }

  // Drag-and-drop handlers
  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setUploadError(null);
    setUploadSuccess(null);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      validateAndSetFile(files[0]);
    }
  }

  // Upload submission
  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile || uploading) return;

    try {
      setUploading(true);
      setUploadError(null);
      setUploadSuccess(null);

      const result = await uploadDocument(selectedFile);
      setUploadSuccess(
        `Document "${selectedFile.name}" successfully uploaded and indexed into ${result.chunks_created} knowledge chunks.`
      );
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      // Refresh listing after successful upload
      await refreshDocuments();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to upload document. Please try again.";
      setUploadError(message);
    } finally {
      setUploading(false);
    }
  }

  // Delete flow
  async function confirmDelete() {
    if (!docToDelete || deleting) return;

    try {
      setDeleting(true);
      setDeleteError(null);
      await deleteDocument(docToDelete.filename);
      setDocToDelete(null);
      await refreshDocuments();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to delete document. Please try again.";
      setDeleteError(message);
    } finally {
      setDeleting(false);
    }
  }

  // Search submission
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query || searching) return;

    try {
      setSearching(true);
      setSearchError(null);
      setHasSearched(true);
      const results = await searchDocuments(query);
      setSearchResults(results);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to perform semantic search. Please try again.";
      setSearchError(message);
      setSearchResults(null);
    } finally {
      setSearching(false);
    }
  }

  // Format bytes helper
  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  // Format date helper
  function formatDate(isoString: string): string {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-bold text-white">Knowledge Base</h2>
        <p className="mt-1 text-sm text-[#9CA3AF]">
          Upload PDF documents to train your Voice AI agent. The agent uses
          these documents to answer caller questions accurately in real time.
        </p>
      </div>

      {/* Upload Notifications */}
      {uploadSuccess && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            <span>{uploadSuccess}</span>
          </div>
          <button
            onClick={() => setUploadSuccess(null)}
            className="text-emerald-400 hover:text-emerald-200"
            aria-label="Dismiss success message"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {uploadError && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start justify-between rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
            <span>{uploadError}</span>
          </div>
          <button
            onClick={() => setUploadError(null)}
            className="text-red-400 hover:text-red-200"
            aria-label="Dismiss error message"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Section 1: Upload Interface */}
      <section className="rounded-xl border border-[#1E1E2A] bg-[#111118] p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2563EB]/10 text-[#2563EB]">
            <UploadCloud className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">
              Upload Document
            </h3>
            <p className="text-xs text-[#9CA3AF]">
              Support PDF format up to 5 MB. Text will be extracted, chunked,
              and vectorized.
            </p>
          </div>
        </div>

        <form onSubmit={handleUpload} className="space-y-4">
          {/* Drag and drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={clsx(
              "group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all",
              isDragging
                ? "border-[#2563EB] bg-[#2563EB]/10"
                : "border-[#1E1E2A] bg-[#0A0A0F]/50 hover:border-[#2563EB]/50 hover:bg-[#0A0A0F]"
            )}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            aria-label="Drag and drop or click to upload PDF file"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileChange}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#1E1E2A] text-[#9CA3AF] group-hover:text-white group-hover:bg-[#2563EB]/20 transition-colors">
              <UploadCloud className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-white">
              Click to browse or drag and drop a PDF
            </p>
            <p className="mt-1 text-xs text-[#9CA3AF]">
              PDF only &bull; Up to 5 MB per document
            </p>
          </div>

          {/* Selected File Card & Actions */}
          {selectedFile && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-lg border border-[#1E1E2A] bg-[#0A0A0F] p-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2563EB]/10 text-[#2563EB]">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-[#9CA3AF]">
                    {formatBytes(selectedFile.size)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => {
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="rounded-lg border border-[#1E1E2A] px-3 py-2 text-xs font-medium text-[#9CA3AF] hover:bg-white/5 hover:text-white transition-colors focus-ring"
                >
                  Remove
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className={clsx(
                    "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-colors focus-ring",
                    uploading
                      ? "cursor-not-allowed bg-[#2563EB]/50"
                      : "bg-[#2563EB] hover:bg-[#1D4ED8]"
                  )}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Processing & Embedding...</span>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="h-3.5 w-3.5" />
                      <span>Upload & Process</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {uploading && (
            <div className="flex items-center gap-2 text-xs text-[#9CA3AF]">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#2563EB]" />
              <span>
                Extracting text, computing 1536-dimensional embeddings, and
                storing vectors in database. This may take a moment...
              </span>
            </div>
          )}
        </form>
      </section>

      {/* Section 2: Uploaded Documents Listing */}
      <section className="rounded-xl border border-[#1E1E2A] bg-[#111118] p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold text-white">
              Indexed Documents
            </h3>
            {!listLoading && (
              <span className="rounded-full bg-[#1E1E2A] px-2.5 py-0.5 text-xs font-medium text-[#9CA3AF]">
                {documents.length} {documents.length === 1 ? "file" : "files"}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={refreshDocuments}
            disabled={listLoading}
            className="flex items-center gap-1.5 rounded-lg border border-[#1E1E2A] bg-[#0A0A0F] px-3 py-1.5 text-xs font-medium text-[#9CA3AF] hover:bg-white/5 hover:text-white transition-colors focus-ring"
            title="Refresh document list"
            aria-label="Refresh document list"
          >
            <RefreshCw
              className={clsx("h-3.5 w-3.5", listLoading && "animate-spin")}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* Loading State */}
        {listLoading && (
          <div className="space-y-3" role="status" aria-label="Loading documents">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border border-[#1E1E2A] bg-[#0A0A0F] p-4 animate-pulse"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-[#1F2937]" />
                  <div className="space-y-2">
                    <div className="h-4 w-48 rounded bg-[#1F2937]" />
                    <div className="h-3 w-28 rounded bg-[#1F2937]" />
                  </div>
                </div>
                <div className="h-8 w-20 rounded bg-[#1F2937]" />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {!listLoading && listError && (
          <div
            role="alert"
            className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-center"
          >
            <AlertCircle className="mx-auto h-8 w-8 text-red-400" />
            <p className="mt-2 text-sm font-semibold text-white">
              Failed to load documents
            </p>
            <p className="mt-1 text-xs text-red-300">{listError}</p>
            <button
              type="button"
              onClick={refreshDocuments}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] transition-colors focus-ring"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try Again
            </button>
          </div>
        )}

        {/* Empty State */}
        {!listLoading && !listError && documents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[#2563EB]/10 text-[#2563EB]">
              <FileText className="h-6 w-6" />
            </div>
            <h4 className="text-sm font-semibold text-white">
              No documents uploaded yet
            </h4>
            <p className="mt-1 max-w-sm text-xs text-[#9CA3AF]">
              Upload your company handbooks, FAQs, service guidelines, or pricing
              sheets to train your Voice AI agent.
            </p>
          </div>
        )}

        {/* Populated Document List */}
        {!listLoading && !listError && documents.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-[#1E1E2A]">
            <div className="divide-y divide-[#1E1E2A]">
              {documents.map((doc) => (
                <div
                  key={doc.filename}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-[#0A0A0F] p-4 transition-colors hover:bg-white/[0.02]"
                >
                  {/* File Info */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2563EB]/10 text-[#2563EB]">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p
                        className="truncate text-sm font-medium text-white"
                        title={doc.original_filename}
                      >
                        {doc.original_filename}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#9CA3AF]">
                        <span className="inline-flex items-center rounded-md bg-[#1E1E2A] px-2 py-0.5 font-medium text-[#D1D5DB]">
                          {doc.chunks_count}{" "}
                          {doc.chunks_count === 1 ? "chunk" : "chunks"}
                        </span>
                        <span>&bull;</span>
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(doc.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => {
                        setDocToDelete(doc);
                        setDeleteError(null);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-transparent px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors focus-ring"
                      aria-label={`Delete ${doc.original_filename}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Section 3: Semantic Search Playground */}
      <section className="rounded-xl border border-[#1E1E2A] bg-[#111118] p-6 space-y-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">
              Semantic Search Playground
            </h3>
            <p className="text-xs text-[#9CA3AF]">
              Test natural-language RAG retrieval against your indexed knowledge
              base. See retrieved chunks and vector similarity scores.
            </p>
          </div>
        </div>

        {/* Search Query Form */}
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder='e.g., "What is our policy on returns and refunds?" or "What are office hours?"'
              className="focus-ring w-full rounded-lg border border-[#1E1E2A] bg-[#0A0A0F] py-2.5 pl-10 pr-4 text-sm text-white placeholder-[#4B5563] transition-colors focus:border-[#2563EB]"
              aria-label="Semantic search query"
            />
          </div>
          <button
            type="submit"
            disabled={searching || !searchQuery.trim()}
            className={clsx(
              "flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-colors focus-ring shrink-0",
              searching || !searchQuery.trim()
                ? "cursor-not-allowed bg-[#2563EB]/40 text-white/60"
                : "bg-[#2563EB] hover:bg-[#1D4ED8]"
            )}
          >
            {searching ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Searching...</span>
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                <span>Search Knowledge</span>
              </>
            )}
          </button>
        </form>

        {/* Search Error */}
        {searchError && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300 flex items-start gap-2.5"
          >
            <AlertCircle className="h-5 w-5 shrink-0 text-red-400 mt-0.5" />
            <span>{searchError}</span>
          </div>
        )}

        {/* Search Results Display */}
        {searching && (
          <div
            className="space-y-3 pt-2"
            role="status"
            aria-label="Searching knowledge base"
          >
            {[1, 2].map((i) => (
              <div
                key={i}
                className="rounded-lg border border-[#1E1E2A] bg-[#0A0A0F] p-4 animate-pulse space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <div className="h-4 w-32 rounded bg-[#1F2937]" />
                  <div className="h-4 w-20 rounded bg-[#1F2937]" />
                </div>
                <div className="h-16 w-full rounded bg-[#1F2937]" />
              </div>
            ))}
          </div>
        )}

        {!searching && hasSearched && searchResults && (
          <div className="space-y-4 pt-2">
            {searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center rounded-lg border border-[#1E1E2A] bg-[#0A0A0F] p-6">
                <SearchX className="h-8 w-8 text-[#9CA3AF] mb-2" />
                <p className="text-sm font-semibold text-white">
                  No matching passages found
                </p>
                <p className="mt-1 max-w-md text-xs text-[#9CA3AF]">
                  No chunks reached the 0.70 similarity threshold for this
                  question. Try phrasing your question differently or upload more
                  relevant documentation.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-[#9CA3AF]">
                  <span>
                    Found{" "}
                    <strong className="text-white">{searchResults.length}</strong>{" "}
                    relevant {searchResults.length === 1 ? "chunk" : "chunks"}
                  </span>
                  <span>Default match threshold &ge; 0.70</span>
                </div>

                {searchResults.map((result) => {
                  const similarityPct = Math.round(result.similarity * 100);
                  const isHighMatch = result.similarity >= 0.8;

                  return (
                    <div
                      key={result.id}
                      className="rounded-lg border border-[#1E1E2A] bg-[#0A0A0F] p-4 transition-colors hover:border-[#2563EB]/40 space-y-2.5"
                    >
                      {/* Result metadata header */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="h-4 w-4 shrink-0 text-[#2563EB]" />
                          <span
                            className="truncate text-xs font-semibold text-white"
                            title={result.original_filename}
                          >
                            {result.original_filename}
                          </span>
                          <span className="rounded bg-[#1E1E2A] px-2 py-0.5 text-[11px] font-medium text-[#9CA3AF]">
                            Chunk #{result.chunk_index + 1}
                          </span>
                        </div>

                        {/* Similarity Score Badge */}
                        <div
                          className={clsx(
                            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                            isHighMatch
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                          )}
                          title={`Cosine similarity: ${result.similarity.toFixed(4)}`}
                        >
                          <span>{similarityPct}% match</span>
                          <span className="text-[10px] opacity-70">
                            ({result.similarity.toFixed(3)})
                          </span>
                        </div>
                      </div>

                      {/* Chunk Text Passage */}
                      <div className="rounded-md border border-[#1E1E2A]/70 bg-[#111118] p-3 text-xs leading-relaxed text-[#D1D5DB] whitespace-pre-wrap font-mono">
                        {result.chunk_text}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Delete Confirmation Modal */}
      {docToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-[#1E1E2A] bg-[#111118] p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3
                  id="delete-dialog-title"
                  className="text-base font-semibold text-white"
                >
                  Delete Document?
                </h3>
                <p className="mt-1 text-xs text-[#9CA3AF]">
                  Are you sure you want to permanently delete{" "}
                  <strong className="text-white">
                    &ldquo;{docToDelete.original_filename}&rdquo;
                  </strong>
                  ?
                </p>
                <p className="mt-2 text-xs text-red-400">
                  This will remove all {docToDelete.chunks_count} indexed
                  vectors from the knowledge base. This action cannot be
                  undone.
                </p>
              </div>
            </div>

            {deleteError && (
              <div
                role="alert"
                className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300"
              >
                {deleteError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  setDocToDelete(null);
                  setDeleteError(null);
                }}
                className="rounded-lg border border-[#1E1E2A] px-4 py-2 text-xs font-medium text-[#9CA3AF] hover:bg-white/5 hover:text-white transition-colors focus-ring"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={confirmDelete}
                className={clsx(
                  "flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-colors focus-ring",
                  deleting
                    ? "cursor-not-allowed bg-red-600/50"
                    : "bg-red-600 hover:bg-red-700"
                )}
              >
                {deleting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete Document</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
