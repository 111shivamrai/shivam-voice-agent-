-- ============================================
-- Voice AI Agent Platform — Phase 1 Schema
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  business_name TEXT DEFAULT '',
  token_balance INTEGER DEFAULT 0,
  agent_name TEXT DEFAULT 'AI Assistant',
  agent_language TEXT DEFAULT 'English',
  telnyx_number TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. RLS policy: users can only read their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- 4. RLS policy: users can only update their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- 5. Grant permissions to authenticated role (RLS restricts rows)
GRANT SELECT, UPDATE ON public.profiles TO authenticated;

-- 6. Trigger function: auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, business_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'business_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Trigger: fire after new auth.users row is inserted
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- Voice AI Agent Platform — Phase 2 Schema: RAG & Documents
-- ============================================

-- 8. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 9. Create document_chunks table
CREATE TABLE IF NOT EXISTS public.document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_document_chunks_client_id
  ON public.document_chunks(client_id);

CREATE INDEX IF NOT EXISTS idx_document_chunks_filename
  ON public.document_chunks(filename);

CREATE INDEX IF NOT EXISTS idx_document_chunks_created_at
  ON public.document_chunks(created_at);

-- HNSW vector cosine similarity index for fast approximate nearest neighbor search
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
  ON public.document_chunks
  USING hnsw (embedding vector_cosine_ops);

-- 11. Enable Row Level Security (RLS)
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

-- 12. RLS Policy: Clients can only access and manage their own document chunks
CREATE POLICY "Users can manage own document chunks"
  ON public.document_chunks
  FOR ALL
  TO authenticated
  USING (auth.uid() = client_id)
  WITH CHECK (auth.uid() = client_id);

-- 13. Grants
GRANT ALL ON public.document_chunks TO authenticated;
GRANT ALL ON public.document_chunks TO service_role;

-- 14. Semantic match function (RPC)
CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector(1536),
  match_client_id UUID,
  match_count INT DEFAULT 5,
  match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id UUID,
  filename TEXT,
  original_filename TEXT,
  chunk_index INT,
  chunk_text TEXT,
  similarity FLOAT,
  metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.filename,
    dc.original_filename,
    dc.chunk_index,
    dc.chunk_text,
    (1 - (dc.embedding <=> query_embedding))::FLOAT AS similarity,
    dc.metadata
  FROM public.document_chunks dc
  WHERE dc.client_id = match_client_id
    AND (1 - (dc.embedding <=> query_embedding)) >= match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_documents TO authenticated, service_role;

