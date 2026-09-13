-- ====================================================================
-- Voice AI Agent Platform — Phase 4: Calls Schema & Atomic Minute Deduction
-- ====================================================================
-- Run this in your Supabase SQL Editor.
--
-- Features:
-- 1. Creates public.calls table to store inbound and outbound call logs, transcripts, duration, and metrics.
-- 2. Enables Row Level Security (RLS) on public.calls so clients can only read their own call records.
-- 3. Creates public.deduct_minutes(UUID, INTEGER) RPC function with row-locking (FOR UPDATE) for ACID-compliant atomic balance deduction.
-- ====================================================================

-- 1. Create calls table
CREATE TABLE IF NOT EXISTS public.calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  caller_number TEXT DEFAULT '',
  called_number TEXT DEFAULT '',
  telnyx_call_id TEXT DEFAULT NULL,
  duration_seconds INTEGER DEFAULT 0,
  minutes_used INTEGER DEFAULT 0,
  transcript JSONB DEFAULT '[]'::jsonb,
  recording_url TEXT DEFAULT NULL,
  status TEXT DEFAULT 'initiated' CHECK (status IN ('initiated', 'ringing', 'in-progress', 'completed', 'failed', 'busy', 'no-answer', 'canceled')),
  language_used TEXT DEFAULT 'english',
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create indexes for high-throughput queries
CREATE INDEX IF NOT EXISTS idx_calls_client_id ON public.calls(client_id);
CREATE INDEX IF NOT EXISTS idx_calls_telnyx_call_id ON public.calls(telnyx_call_id);
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON public.calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_status ON public.calls(status);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policy: Users can only view their own calls
DROP POLICY IF EXISTS "Users can view own calls" ON public.calls;
CREATE POLICY "Users can view own calls"
  ON public.calls FOR SELECT
  USING (auth.uid() = client_id);

-- 5. Grant read access to authenticated role
GRANT SELECT ON public.calls TO authenticated;

-- 6. Grant full access to service_role for backend operations
GRANT ALL ON public.calls TO service_role;

-- ====================================================================
-- 7. Atomic Minute Deduction Function
-- ====================================================================
-- Purpose:
-- Atomically deducts call duration minutes from profiles.token_balance using FOR UPDATE row locking.
-- Ensures that concurrent call terminations cannot cause race conditions or negative balances.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.deduct_minutes(
  p_client_id UUID,
  p_minutes INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
  v_deducted INTEGER;
BEGIN
  -- Validate input minutes
  IF p_minutes IS NULL OR p_minutes <= 0 THEN
    -- Nothing to deduct
    SELECT token_balance INTO v_current_balance
    FROM public.profiles
    WHERE id = p_client_id;

    RETURN jsonb_build_object(
      'success', true,
      'deducted', 0,
      'remaining_balance', COALESCE(v_current_balance, 0),
      'client_id', p_client_id
    );
  END IF;

  -- 1. Lock profile row for update
  SELECT token_balance
  INTO v_current_balance
  FROM public.profiles
  WHERE id = p_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'profile_not_found',
      'message', 'Client profile not found',
      'client_id', p_client_id
    );
  END IF;

  v_current_balance := COALESCE(v_current_balance, 0);

  -- 2. Calculate actual deductible amount (cannot go below 0)
  v_deducted := LEAST(v_current_balance, p_minutes);
  v_new_balance := GREATEST(0, v_current_balance - p_minutes);

  -- 3. Update token balance
  UPDATE public.profiles
  SET token_balance = v_new_balance
  WHERE id = p_client_id;

  -- 4. Return deduction result
  RETURN jsonb_build_object(
    'success', true,
    'deducted', v_deducted,
    'minutes_requested', p_minutes,
    'remaining_balance', v_new_balance,
    'client_id', p_client_id
  );
END;
$$;

-- Grant execute permissions to service_role
GRANT EXECUTE ON FUNCTION public.deduct_minutes(UUID, INTEGER) TO service_role;
