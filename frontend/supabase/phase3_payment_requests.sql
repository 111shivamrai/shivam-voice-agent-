-- ============================================
-- Voice AI Agent Platform — Phase 3 Schema
-- Payment Requests & Manual PhonePe Flow
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. Create payment_requests table
CREATE TABLE IF NOT EXISTS public.payment_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  minutes_requested INTEGER NOT NULL,
  utr_number TEXT NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL
    CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  resolved_at TIMESTAMP WITH TIME ZONE
);

-- 2. Performance Indexes
CREATE INDEX IF NOT EXISTS payment_requests_status_idx
  ON public.payment_requests(status);

CREATE INDEX IF NOT EXISTS payment_requests_client_id_idx
  ON public.payment_requests(client_id);

-- 3. Row Level Security (RLS)
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies: Authenticated clients can only view and create their own payment requests
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'payment_requests' 
      AND policyname = 'Users view own payments'
  ) THEN
    CREATE POLICY "Users view own payments"
      ON public.payment_requests
      FOR SELECT
      TO authenticated
      USING (auth.uid() = client_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'payment_requests' 
      AND policyname = 'Users create own payments'
  ) THEN
    CREATE POLICY "Users create own payments"
      ON public.payment_requests
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = client_id);
  END IF;
END $$;

-- 5. Strict role permissions (No client UPDATE or DELETE granted to authenticated)
GRANT SELECT, INSERT ON public.payment_requests TO authenticated;
GRANT ALL ON public.payment_requests TO service_role;
