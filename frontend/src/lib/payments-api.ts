import { createClient } from "@/lib/supabase/client";

export interface PaymentRequestRecord {
  id: string;
  client_id?: string;
  amount: number;
  minutes_requested: number;
  utr_number: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  resolved_at?: string | null;
  admin_note?: string | null;
  client_email?: string | null;
  client_business_name?: string | null;
}

export interface ClientBalanceResponse {
  balance: number;
  label: string;
}

export interface CreatePaymentResponse {
  message: string;
  minutes_requested: number;
}

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
async function extractErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
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
    // If not valid JSON, use fallback with status
  }
  return `${fallback} (HTTP ${response.status})`;
}

/**
 * GET /payments/balance
 * Fetches the authenticated client's minutes balance.
 */
export async function getClientBalance(): Promise<ClientBalanceResponse> {
  const token = await getAuthToken();
  const baseUrl = getApiBaseUrl();

  let response = await fetch(`${baseUrl}/payments/balance`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  // Fallback to /api/payments/balance if 404
  if (response.status === 404) {
    response = await fetch(`${baseUrl}/api/payments/balance`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  }

  if (!response.ok) {
    const errorMsg = await extractErrorMessage(
      response,
      "Failed to retrieve balance."
    );
    throw new Error(errorMsg);
  }

  return (await response.json()) as ClientBalanceResponse;
}

/**
 * GET /payments/history
 * Fetches payment history for the authenticated client.
 */
export async function getClientPaymentHistory(): Promise<PaymentRequestRecord[]> {
  const token = await getAuthToken();
  const baseUrl = getApiBaseUrl();

  let response = await fetch(`${baseUrl}/payments/history`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  // Fallback to /api/payments/history if 404
  if (response.status === 404) {
    response = await fetch(`${baseUrl}/api/payments/history`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  }

  if (!response.ok) {
    const errorMsg = await extractErrorMessage(
      response,
      "Failed to retrieve payment history."
    );
    throw new Error(errorMsg);
  }

  const data = (await response.json()) as { payments: PaymentRequestRecord[] };
  return data.payments || [];
}

/**
 * POST /payments/request
 * Submits a new payment request for manual verification.
 */
export async function submitPaymentRequest(
  amount: number,
  utr_number: string
): Promise<CreatePaymentResponse> {
  const token = await getAuthToken();
  const baseUrl = getApiBaseUrl();

  let response = await fetch(`${baseUrl}/payments/request`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      amount,
      utr_number,
    }),
  });

  // Fallback to /api/payments/request if 404
  if (response.status === 404) {
    response = await fetch(`${baseUrl}/api/payments/request`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        amount,
        utr_number,
      }),
    });
  }

  if (!response.ok) {
    const errorMsg = await extractErrorMessage(
      response,
      "Failed to submit payment request."
    );
    throw new Error(errorMsg);
  }

  return (await response.json()) as CreatePaymentResponse;
}
