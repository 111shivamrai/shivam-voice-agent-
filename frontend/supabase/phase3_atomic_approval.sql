-- ====================================================================
-- Voice AI Agent Platform — Phase 3: Atomic Payment Approval Function
-- ====================================================================
-- Purpose:
-- Ensures true ACID transactional atomicity during payment approval:
-- 1. Locks the payment_requests row FOR UPDATE (prevents concurrent race conditions)
-- 2. Validates that the payment is still in 'pending' status
-- 3. Atomically increments profiles.token_balance by minutes_requested
-- 4. Transitions payment_requests.status to 'approved' and records resolved_at
-- 5. If ANY step fails, PostgreSQL automatically rolls back the entire transaction.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.approve_payment_request(
  p_payment_id UUID,
  p_admin_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment RECORD;
  v_new_balance INTEGER;
BEGIN
  -- 1. Lock payment request row for update (blocks concurrent executions)
  SELECT id, client_id, minutes_requested, status
  INTO v_payment
  FROM public.payment_requests
  WHERE id = p_payment_id
  FOR UPDATE;

  -- Payment does not exist
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'not_found',
      'message', 'Payment request not found.'
    );
  END IF;

  -- Payment is not in pending status (already approved or rejected)
  IF v_payment.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'already_processed',
      'message', 'This payment has already been processed'
    );
  END IF;

  -- 2. Atomically credit minutes to profiles.token_balance
  UPDATE public.profiles
  SET token_balance = COALESCE(token_balance, 0) + v_payment.minutes_requested
  WHERE id = v_payment.client_id
  RETURNING token_balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client profile not found for client %', v_payment.client_id;
  END IF;

  -- 3. Transition payment request status to approved
  UPDATE public.payment_requests
  SET 
    status = 'approved',
    resolved_at = NOW(),
    admin_note = COALESCE(p_admin_note, admin_note)
  WHERE id = p_payment_id;

  -- 4. Return success and exact credit metrics
  RETURN jsonb_build_object(
    'success', true,
    'minutes_added', v_payment.minutes_requested,
    'new_balance', v_new_balance,
    'client_id', v_payment.client_id
  );
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.approve_payment_request(UUID, TEXT) TO service_role;
