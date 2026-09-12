"use client";

import { useState } from "react";
import {
  Check,
  X,
  Loader2,
  AlertTriangle,
  Mail,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import clsx from "clsx";
import { useAdmin } from "@/app/admin/layout";
import { approvePayment, rejectPayment } from "@/lib/admin-api";
import type { PaymentRequestRecord } from "@/lib/payments-api";

interface AdminPendingPaymentsProps {
  payments: PaymentRequestRecord[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onPaymentResolved?: (id: string, action: "approved" | "rejected", msg: string) => void;
}

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

export default function AdminPendingPayments({
  payments,
  loading,
  error,
  onRefresh,
  onPaymentResolved,
}: AdminPendingPaymentsProps) {
  const { adminPassword } = useAdmin();

  // In-flight action tracking (prevent double-clicks & concurrent operations)
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"approve" | "reject" | null>(null);

  // Reject modal state
  const [rejectModalRecord, setRejectModalRecord] =
    useState<PaymentRequestRecord | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // Handle Approve
  async function handleApprove(record: PaymentRequestRecord) {
    if (resolvingId) return;

    try {
      setResolvingId(record.id);
      setActionType("approve");
      setActionError(null);

      const res = await approvePayment(record.id, adminPassword);
      onPaymentResolved?.(
        record.id,
        "approved",
        res.message || "Payment approved. Minutes added to client account."
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to approve payment.";
      setActionError(msg);
    } finally {
      setResolvingId(null);
      setActionType(null);
    }
  }

  // Open Reject Modal
  function openRejectModal(record: PaymentRequestRecord) {
    if (resolvingId) return;
    setRejectModalRecord(record);
    setRejectReason("");
    setActionError(null);
  }

  // Confirm Reject
  async function handleConfirmReject(e: React.FormEvent) {
    e.preventDefault();
    if (!rejectModalRecord || resolvingId) return;

    try {
      setResolvingId(rejectModalRecord.id);
      setActionType("reject");
      setActionError(null);

      const note = rejectReason.trim() || "Rejected by administrator";
      const res = await rejectPayment(rejectModalRecord.id, adminPassword, note);

      setRejectModalRecord(null);
      setRejectReason("");
      onPaymentResolved?.(
        rejectModalRecord.id,
        "rejected",
        res.message || "Payment rejected."
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reject payment.";
      setActionError(msg);
    } finally {
      setResolvingId(null);
      setActionType(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Inline Action Error Alert */}
      {actionError && (
        <div
          role="alert"
          className="flex items-start justify-between rounded-xl border border-red-500/20 bg-red-500/10 p-3.5 text-xs text-red-300"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-red-400 hover:text-red-200"
            aria-label="Dismiss error"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <div className="space-y-3" role="status" aria-label="Loading pending payments">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-xl border border-[#1F2937] bg-[#111118] p-4 animate-pulse"
            >
              <div className="space-y-2">
                <div className="h-4 w-44 rounded bg-[#1F2937]" />
                <div className="h-3 w-32 rounded bg-[#1F2937]" />
              </div>
              <div className="h-8 w-36 rounded bg-[#1F2937]" />
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-center"
        >
          <AlertTriangle className="mx-auto h-7 w-7 text-red-400" />
          <p className="mt-2 text-sm font-semibold text-white">
            Failed to load pending payments
          </p>
          <p className="mt-1 text-xs text-red-300">{error}</p>
          <button
            type="button"
            onClick={onRefresh}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Try Again</span>
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && payments.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-[#1F2937] bg-[#111118] py-12 px-4 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h4 className="text-sm font-semibold text-white">
            No pending payments. All caught up!
          </h4>
          <p className="mt-1 max-w-sm text-xs text-[#9CA3AF]">
            New client payment requests submitted via PhonePe UPI will appear here for manual verification.
          </p>
        </div>
      )}

      {/* Populated Pending Payments */}
      {!loading && !error && payments.length > 0 && (
        <div>
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-[#1F2937] bg-[#111118]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#1F2937] bg-[#0A0A0F] text-[#9CA3AF] uppercase font-semibold">
                <tr>
                  <th scope="col" className="px-4 py-3">User Email</th>
                  <th scope="col" className="px-4 py-3">Amount</th>
                  <th scope="col" className="px-4 py-3">Minutes</th>
                  <th scope="col" className="px-4 py-3">UTR / Ref No.</th>
                  <th scope="col" className="px-4 py-3">Time Submitted</th>
                  <th scope="col" className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1F2937] bg-[#111118]">
                {payments.map((record) => {
                  const isProcessing = resolvingId === record.id;
                  return (
                    <tr
                      key={record.id}
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-4 py-3.5 text-white">
                        <div className="flex items-center gap-2">
                          <Mail className="h-3.5 w-3.5 text-[#9CA3AF]" />
                          <span className="font-medium">
                            {record.client_email || record.client_id || "Unknown Client"}
                          </span>
                        </div>
                        {record.client_business_name && (
                          <div className="text-[11px] text-[#9CA3AF] ml-5">
                            {record.client_business_name}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 font-bold text-white whitespace-nowrap">
                        ₹{record.amount.toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-emerald-400 whitespace-nowrap">
                        +{record.minutes_requested} mins
                      </td>
                      <td className="px-4 py-3.5 font-mono text-white font-medium whitespace-nowrap">
                        <span className="rounded bg-[#0A0A0F] px-2 py-1 border border-[#1F2937]">
                          {record.utr_number}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-[#9CA3AF] whitespace-nowrap">
                        {formatDate(record.created_at)}
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={Boolean(resolvingId)}
                            onClick={() => handleApprove(record)}
                            className={clsx(
                              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500",
                              isProcessing && actionType === "approve"
                                ? "bg-emerald-600/50 text-white cursor-not-allowed"
                                : "bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                            )}
                          >
                            {isProcessing && actionType === "approve" ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>Approving...</span>
                              </>
                            ) : (
                              <>
                                <Check className="h-3.5 w-3.5" />
                                <span>Approve</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            disabled={Boolean(resolvingId)}
                            onClick={() => openRejectModal(record)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <X className="h-3.5 w-3.5" />
                            <span>Reject</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards View */}
          <div className="md:hidden space-y-3">
            {payments.map((record) => {
              const isProcessing = resolvingId === record.id;
              return (
                <div
                  key={record.id}
                  className="rounded-xl border border-[#1F2937] bg-[#111118] p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">
                        {record.client_email || "Unknown Client"}
                      </div>
                      {record.client_business_name && (
                        <div className="text-[11px] text-[#9CA3AF]">
                          {record.client_business_name}
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] text-[#9CA3AF]">
                      {formatDate(record.created_at)}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between pt-1">
                    <div>
                      <span className="text-base font-extrabold text-white">
                        ₹{record.amount.toLocaleString("en-IN")}
                      </span>
                    </div>
                    <span className="text-xs font-bold text-emerald-400">
                      +{record.minutes_requested} minutes
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-[#9CA3AF] border-t border-[#1F2937] pt-2">
                    <span>UTR / Ref:</span>
                    <span className="font-mono text-white font-medium bg-[#0A0A0F] px-2 py-0.5 rounded border border-[#1F2937]">
                      {record.utr_number}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={Boolean(resolvingId)}
                      onClick={() => handleApprove(record)}
                      className={clsx(
                        "flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500",
                        isProcessing && actionType === "approve"
                          ? "bg-emerald-600/50 text-white cursor-not-allowed"
                          : "bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
                      )}
                    >
                      {isProcessing && actionType === "approve" ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Approving...</span>
                        </>
                      ) : (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          <span>Approve</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={Boolean(resolvingId)}
                      onClick={() => openRejectModal(record)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-40"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>Reject</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Rejection Confirmation Modal */}
      {rejectModalRecord && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 overflow-y-auto"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#1F2937] bg-[#111118] p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 id="reject-dialog-title" className="text-base font-semibold text-white">
                  Reject Payment Request?
                </h3>
                <p className="mt-1 text-xs text-[#9CA3AF]">
                  Are you sure you want to reject payment of{" "}
                  <strong className="text-white">
                    ₹{rejectModalRecord.amount} ({rejectModalRecord.minutes_requested} mins)
                  </strong>{" "}
                  for UTR <span className="font-mono text-white">{rejectModalRecord.utr_number}</span>?
                </p>
              </div>
            </div>

            <form onSubmit={handleConfirmReject} className="space-y-4 pt-1">
              <div>
                <label
                  htmlFor="reject-reason-input"
                  className="block text-xs font-semibold uppercase tracking-wider text-white mb-1.5"
                >
                  Rejection Reason (Optional / Shown to Client)
                </label>
                <textarea
                  id="reject-reason-input"
                  rows={3}
                  placeholder="e.g. UTR number not found on bank statement, or amount mismatch"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  disabled={Boolean(resolvingId)}
                  className="w-full rounded-lg border border-[#1F2937] bg-[#0A0A0F] px-3 py-2 text-xs text-white placeholder-[#9CA3AF]/40 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={Boolean(resolvingId)}
                  onClick={() => setRejectModalRecord(null)}
                  className="rounded-lg border border-[#1F2937] px-4 py-2 text-xs font-medium text-[#9CA3AF] hover:bg-white/5 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={Boolean(resolvingId)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                >
                  {resolvingId === rejectModalRecord.id && actionType === "reject" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Rejecting...</span>
                    </>
                  ) : (
                    <span>Confirm Rejection</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
