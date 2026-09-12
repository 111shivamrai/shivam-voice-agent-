import { getApiBaseUrl } from "@/lib/payments-api";
import type { PaymentRequestRecord } from "@/lib/payments-api";

export interface AdminStatsResponse {
  pending_payment_count: number;
  total_payment_count: number;
  approved_payment_count: number;
  rejected_payment_count: number;
  total_approved_amount: number;
  total_approved_minutes: number;
}

export interface ApprovePaymentResponse {
  message: string;
  minutes_added: number;
}

export interface RejectPaymentResponse {
  message: string;
}

export interface VerifyAdminResponse {
  success: boolean;
  message: string;
}

const ADMIN_STORAGE_KEY = "adminPassword";

/**
 * Helper to get the admin password from sessionStorage
 */
export function getStoredAdminPassword(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(ADMIN_STORAGE_KEY);
}

/**
 * Helper to store the admin password in sessionStorage
 */
export function setStoredAdminPassword(password: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(ADMIN_STORAGE_KEY, password);
}

/**
 * Helper to clear the stored admin password from sessionStorage
 */
export function clearStoredAdminPassword(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(ADMIN_STORAGE_KEY);
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
    // If not valid JSON, use fallback with HTTP status
  }
  return `${fallback} (HTTP ${response.status})`;
}

/**
 * GET /admin/verify
 * Validates the admin password header with the NestJS backend.
 */
export async function verifyAdmin(password: string): Promise<VerifyAdminResponse> {
  const baseUrl = getApiBaseUrl();

  let response = await fetch(`${baseUrl}/admin/verify`, {
    method: "GET",
    headers: {
      "x-admin-password": password,
      Accept: "application/json",
    },
  });

  // Fallback to /api/admin/verify if 404
  if (response.status === 404) {
    response = await fetch(`${baseUrl}/api/admin/verify`, {
      method: "GET",
      headers: {
        "x-admin-password": password,
        Accept: "application/json",
      },
    });
  }

  if (!response.ok) {
    const errorMsg = await extractErrorMessage(response, "Invalid credentials");
    throw new Error(errorMsg);
  }

  return (await response.json()) as VerifyAdminResponse;
}

/**
 * GET /admin/stats
 * Retrieves aggregated payment statistics.
 */
export async function getAdminStats(
  password: string
): Promise<AdminStatsResponse> {
  const baseUrl = getApiBaseUrl();

  let response = await fetch(`${baseUrl}/admin/stats`, {
    method: "GET",
    headers: {
      "x-admin-password": password,
      Accept: "application/json",
    },
  });

  if (response.status === 404) {
    response = await fetch(`${baseUrl}/api/admin/stats`, {
      method: "GET",
      headers: {
        "x-admin-password": password,
        Accept: "application/json",
      },
    });
  }

  if (!response.ok) {
    const errorMsg = await extractErrorMessage(
      response,
      "Failed to retrieve admin stats."
    );
    throw new Error(errorMsg);
  }

  return (await response.json()) as AdminStatsResponse;
}

/**
 * GET /admin/payments/pending
 * Retrieves all pending payment requests, ordered oldest first.
 */
export async function getPendingPayments(
  password: string
): Promise<{ payments: PaymentRequestRecord[]; count: number }> {
  const baseUrl = getApiBaseUrl();

  let response = await fetch(`${baseUrl}/admin/payments/pending`, {
    method: "GET",
    headers: {
      "x-admin-password": password,
      Accept: "application/json",
    },
  });

  if (response.status === 404) {
    response = await fetch(`${baseUrl}/api/admin/payments/pending`, {
      method: "GET",
      headers: {
        "x-admin-password": password,
        Accept: "application/json",
      },
    });
  }

  if (!response.ok) {
    const errorMsg = await extractErrorMessage(
      response,
      "Failed to retrieve pending payments."
    );
    throw new Error(errorMsg);
  }

  return (await response.json()) as {
    payments: PaymentRequestRecord[];
    count: number;
  };
}

/**
 * GET /admin/payments
 * Retrieves all payments (pending, approved, rejected), ordered newest first.
 */
export async function getAllPayments(
  password: string
): Promise<{ payments: PaymentRequestRecord[]; count: number }> {
  const baseUrl = getApiBaseUrl();

  let response = await fetch(`${baseUrl}/admin/payments`, {
    method: "GET",
    headers: {
      "x-admin-password": password,
      Accept: "application/json",
    },
  });

  if (response.status === 404) {
    response = await fetch(`${baseUrl}/api/admin/payments`, {
      method: "GET",
      headers: {
        "x-admin-password": password,
        Accept: "application/json",
      },
    });
  }

  if (!response.ok) {
    const errorMsg = await extractErrorMessage(
      response,
      "Failed to retrieve payments."
    );
    throw new Error(errorMsg);
  }

  return (await response.json()) as {
    payments: PaymentRequestRecord[];
    count: number;
  };
}

/**
 * POST /admin/payments/:id/approve
 * Atomically approves a pending payment and credits minutes to the client account.
 */
export async function approvePayment(
  id: string,
  password: string
): Promise<ApprovePaymentResponse> {
  const baseUrl = getApiBaseUrl();

  let response = await fetch(`${baseUrl}/admin/payments/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    headers: {
      "x-admin-password": password,
      Accept: "application/json",
    },
  });

  if (response.status === 404) {
    response = await fetch(`${baseUrl}/api/admin/payments/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      headers: {
        "x-admin-password": password,
        Accept: "application/json",
      },
    });
  }

  if (!response.ok) {
    const errorMsg = await extractErrorMessage(
      response,
      "Failed to approve payment."
    );
    throw new Error(errorMsg);
  }

  return (await response.json()) as ApprovePaymentResponse;
}

/**
 * POST /admin/payments/:id/reject
 * Atomically rejects a pending payment with an optional admin note.
 */
export async function rejectPayment(
  id: string,
  password: string,
  adminNote?: string
): Promise<RejectPaymentResponse> {
  const baseUrl = getApiBaseUrl();

  const bodyPayload = adminNote ? JSON.stringify({ admin_note: adminNote }) : JSON.stringify({});

  let response = await fetch(`${baseUrl}/admin/payments/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    headers: {
      "x-admin-password": password,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: bodyPayload,
  });

  if (response.status === 404) {
    response = await fetch(`${baseUrl}/api/admin/payments/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      headers: {
        "x-admin-password": password,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: bodyPayload,
    });
  }

  if (!response.ok) {
    const errorMsg = await extractErrorMessage(
      response,
      "Failed to reject payment."
    );
    throw new Error(errorMsg);
  }

  return (await response.json()) as RejectPaymentResponse;
}
