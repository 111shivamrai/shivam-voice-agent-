"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Clock,
  CheckCircle2,
  XCircle,
  Search,
  RefreshCw,
  AlertTriangle,
  Mail,
  Calendar,
  X,
  CreditCard,
} from "lucide-react";
import clsx from "clsx";
import { useAdmin } from "@/app/admin/layout";
import {
  getPendingPayments,
  getAllPayments,
} from "@/lib/admin-api";
import type { PaymentRequestRecord } from "@/lib/payments-api";
import AdminPendingPayments from "@/components/AdminPendingPayments";

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

export default function AdminPaymentsPage() {
  const { adminPassword } = useAdmin();

  // Tab state: 'pending' | 'all'
  const [activeTab, setActiveTab] = useState<"pending" | "all">("pending");

  // Pending payments state
  const [pendingPayments, setPendingPayments] = useState<PaymentRequestRecord[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState<string | null>(null);

  // All payments state
  const [allPayments, setAllPayments] = useState<PaymentRequestRecord[]>([]);
  const [allLoading, setAllLoading] = useState(true);
  const [allError, setAllError] = useState<string | null>(null);

  // Search state for "All Payments" tab
  const [searchQuery, setSearchQuery] = useState("");

  // Notification
  const [actionNotification, setActionNotification] = useState<string | null>(null);

  // 1. Fetch pending payments
  const fetchPending = useCallback(async () => {
    try {
      setPendingLoading(true);
      setPendingError(null);
      const res = await getPendingPayments(adminPassword);
      setPendingPayments(res.payments || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load pending payments.";
      setPendingError(msg);
    } finally {
      setPendingLoading(false);
    }
  }, [adminPassword]);

  // 2. Fetch all payments
  const fetchAll = useCallback(async () => {
    try {
      setAllLoading(true);
      setAllError(null);
      const res = await getAllPayments(adminPassword);
      setAllPayments(res.payments || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load payment history.";
      setAllError(msg);
    } finally {
      setAllLoading(false);
    }
  }, [adminPassword]);

  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        const [pendingRes, allRes] = await Promise.allSettled([
          getPendingPayments(adminPassword),
          getAllPayments(adminPassword),
        ]);

        if (!isMounted) return;

        if (pendingRes.status === "fulfilled") {
          setPendingPayments(pendingRes.value.payments || []);
          setPendingError(null);
        } else {
          const msg =
            pendingRes.reason instanceof Error
              ? pendingRes.reason.message
              : "Failed to load pending payments.";
          setPendingError(msg);
        }

        if (allRes.status === "fulfilled") {
          setAllPayments(allRes.value.payments || []);
          setAllError(null);
        } else {
          const msg =
            allRes.reason instanceof Error
              ? allRes.reason.message
              : "Failed to load payment history.";
          setAllError(msg);
        }
      } finally {
        if (isMounted) {
          setPendingLoading(false);
          setAllLoading(false);
        }
      }
    }

    init();

    return () => {
      isMounted = false;
    };
  }, [adminPassword]);

  // Handle resolution from pending sub-component
  function handlePaymentResolved(
    id: string,
    action: "approved" | "rejected",
    msg: string
  ) {
    setPendingPayments((prev) => prev.filter((p) => p.id !== id));
    setActionNotification(msg);
    // Refresh all payments list to reflect updated status
    fetchAll();
  }

  // Filter all payments by case-insensitive email or UTR
  const filteredAllPayments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allPayments;

    return allPayments.filter((p) => {
      const emailMatch = (p.client_email || p.client_id || "").toLowerCase().includes(q);
      const utrMatch = (p.utr_number || "").toLowerCase().includes(q);
      const bizMatch = (p.client_business_name || "").toLowerCase().includes(q);
      return emailMatch || utrMatch || bizMatch;
    });
  }, [allPayments, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Payment Management
          </h1>
          <p className="mt-1 text-xs text-[#9CA3AF]">
            Review pending top-up submissions or inspect the full audit trail of client transactions.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            fetchPending();
            fetchAll();
          }}
          disabled={pendingLoading || allLoading}
          className="self-start sm:self-auto inline-flex items-center gap-1.5 rounded-lg border border-[#1F2937] bg-[#111118] px-3.5 py-2 text-xs font-medium text-[#9CA3AF] hover:bg-white/5 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${
              pendingLoading || allLoading ? "animate-spin" : ""
            }`}
          />
          <span>Refresh Lists</span>
        </button>
      </div>

      {/* Action Notification Banner */}
      {actionNotification && (
        <div
          role="status"
          className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-xs text-emerald-300 transition-all"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{actionNotification}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionNotification(null)}
            className="text-emerald-400 hover:text-emerald-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-[#1F2937]">
        <nav className="flex space-x-6" aria-label="Payments tabs">
          <button
            type="button"
            onClick={() => setActiveTab("pending")}
            className={clsx(
              "flex items-center gap-2 border-b-2 py-3 text-xs font-semibold transition-colors focus:outline-none",
              activeTab === "pending"
                ? "border-[#2563EB] text-white"
                : "border-transparent text-[#9CA3AF] hover:border-[#1F2937] hover:text-white"
            )}
          >
            <Clock className="h-4 w-4 text-amber-400" />
            <span>Pending Approvals</span>
            {!pendingLoading && pendingPayments.length > 0 && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                {pendingPayments.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={clsx(
              "flex items-center gap-2 border-b-2 py-3 text-xs font-semibold transition-colors focus:outline-none",
              activeTab === "all"
                ? "border-[#2563EB] text-white"
                : "border-transparent text-[#9CA3AF] hover:border-[#1F2937] hover:text-white"
            )}
          >
            <CreditCard className="h-4 w-4 text-[#2563EB]" />
            <span>All Payments</span>
            {!allLoading && (
              <span className="rounded-full bg-[#1F2937] px-2 py-0.5 text-[10px] font-medium text-[#9CA3AF]">
                {allPayments.length}
              </span>
            )}
          </button>
        </nav>
      </div>

      {/* TAB CONTENT: PENDING */}
      {activeTab === "pending" && (
        <section className="space-y-4">
          <AdminPendingPayments
            payments={pendingPayments}
            loading={pendingLoading}
            error={pendingError}
            onRefresh={fetchPending}
            onPaymentResolved={handlePaymentResolved}
          />
        </section>
      )}

      {/* TAB CONTENT: ALL PAYMENTS */}
      {activeTab === "all" && (
        <section className="space-y-4">
          {/* Search bar */}
          <div className="flex items-center justify-between gap-4">
            <div className="relative w-full max-w-md">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]">
                <Search className="h-4 w-4" />
              </span>
              <input
                type="text"
                placeholder="Search by client email or UTR..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-[#1F2937] bg-[#111118] pl-10 pr-9 py-2.5 text-xs text-white placeholder-[#9CA3AF]/40 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                aria-label="Search all payments"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {!allLoading && !allError && (
              <span className="text-xs text-[#9CA3AF] shrink-0 hidden sm:inline">
                Showing {filteredAllPayments.length} of {allPayments.length}
              </span>
            )}
          </div>

          {/* Loading Skeletons */}
          {allLoading && (
            <div className="space-y-3" role="status" aria-label="Loading payments">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-16 rounded-xl border border-[#1F2937] bg-[#111118] animate-pulse p-4"
                />
              ))}
            </div>
          )}

          {/* Error State */}
          {!allLoading && allError && (
            <div
              role="alert"
              className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-center"
            >
              <AlertTriangle className="mx-auto h-7 w-7 text-red-400" />
              <p className="mt-2 text-sm font-semibold text-white">
                Failed to load all payments
              </p>
              <p className="mt-1 text-xs text-red-300">{allError}</p>
              <button
                type="button"
                onClick={fetchAll}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Try Again</span>
              </button>
            </div>
          )}

          {/* Empty State: No payments in system */}
          {!allLoading && !allError && allPayments.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-[#1F2937] bg-[#111118] py-12 px-4 text-center">
              <CreditCard className="h-8 w-8 text-[#9CA3AF] mb-3" />
              <h4 className="text-sm font-semibold text-white">No payments recorded yet</h4>
              <p className="mt-1 text-xs text-[#9CA3AF]">
                When clients submit top-up requests, the entire audit history will be displayed here.
              </p>
            </div>
          )}

          {/* Empty State: Search matches nothing */}
          {!allLoading &&
            !allError &&
            allPayments.length > 0 &&
            filteredAllPayments.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-[#1F2937] bg-[#111118] py-10 px-4 text-center">
                <Search className="h-7 w-7 text-[#9CA3AF] mb-2" />
                <h4 className="text-sm font-semibold text-white">
                  No matching payments found
                </h4>
                <p className="mt-1 text-xs text-[#9CA3AF]">
                  No payment records match &ldquo;{searchQuery}&rdquo;. Try another search term.
                </p>
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="mt-3 text-xs text-[#2563EB] font-semibold hover:underline"
                >
                  Clear search
                </button>
              </div>
            )}

          {/* Populated All Payments: Table on Desktop & Cards on Mobile */}
          {!allLoading && !allError && filteredAllPayments.length > 0 && (
            <div>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto rounded-xl border border-[#1F2937] bg-[#111118]">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#1F2937] bg-[#0A0A0F] text-[#9CA3AF] uppercase font-semibold">
                    <tr>
                      <th scope="col" className="px-4 py-3">Date</th>
                      <th scope="col" className="px-4 py-3">User Email</th>
                      <th scope="col" className="px-4 py-3">Amount</th>
                      <th scope="col" className="px-4 py-3">Minutes</th>
                      <th scope="col" className="px-4 py-3">UTR</th>
                      <th scope="col" className="px-4 py-3">Status</th>
                      <th scope="col" className="px-4 py-3">Details / Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1F2937] bg-[#111118]">
                    {filteredAllPayments.map((record) => (
                      <tr
                        key={record.id}
                        className="hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="px-4 py-3 text-white whitespace-nowrap">
                          {formatDate(record.created_at)}
                        </td>
                        <td className="px-4 py-3 text-white">
                          <div className="flex items-center gap-1.5">
                            <Mail className="h-3 w-3 text-[#9CA3AF]" />
                            <span className="font-medium">
                              {record.client_email || record.client_id || "Unknown Client"}
                            </span>
                          </div>
                          {record.client_business_name && (
                            <div className="text-[10px] text-[#9CA3AF] ml-4.5">
                              {record.client_business_name}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-bold text-white whitespace-nowrap">
                          ₹{record.amount.toLocaleString("en-IN")}
                        </td>
                        <td className="px-4 py-3 font-semibold text-emerald-400 whitespace-nowrap">
                          +{record.minutes_requested} mins
                        </td>
                        <td className="px-4 py-3 font-mono text-white whitespace-nowrap">
                          <span className="rounded bg-[#0A0A0F] px-2 py-0.5 border border-[#1F2937]">
                            {record.utr_number}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {record.status === "pending" && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                              Pending
                            </span>
                          )}
                          {record.status === "approved" && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" />
                              Approved
                            </span>
                          )}
                          {record.status === "rejected" && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-400">
                              <XCircle className="h-3 w-3" />
                              Rejected
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs max-w-xs truncate">
                          {record.status === "rejected" ? (
                            <span className="text-red-300">
                              {record.admin_note || "Rejected by administrator"}
                            </span>
                          ) : record.status === "approved" ? (
                            <span className="text-[#9CA3AF]">
                              {record.resolved_at
                                ? `Approved on ${formatDate(record.resolved_at)}`
                                : "Approved"}
                              {record.admin_note ? ` (${record.admin_note})` : ""}
                            </span>
                          ) : (
                            <span className="text-[#9CA3AF]/60">Awaiting admin review</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards View */}
              <div className="md:hidden space-y-3">
                {filteredAllPayments.map((record) => (
                  <div
                    key={record.id}
                    className="rounded-xl border border-[#1F2937] bg-[#111118] p-4 space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#9CA3AF] flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(record.created_at)}
                      </span>
                      {record.status === "pending" && (
                        <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                          Pending
                        </span>
                      )}
                      {record.status === "approved" && (
                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                          Approved
                        </span>
                      )}
                      {record.status === "rejected" && (
                        <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400">
                          Rejected
                        </span>
                      )}
                    </div>

                    <div className="text-xs font-semibold text-white truncate">
                      {record.client_email || record.client_id || "Unknown Client"}
                    </div>

                    <div className="flex items-baseline justify-between pt-1">
                      <span className="text-base font-extrabold text-white">
                        ₹{record.amount.toLocaleString("en-IN")}
                      </span>
                      <span className="text-xs font-bold text-emerald-400">
                        +{record.minutes_requested} minutes
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-[#9CA3AF] border-t border-[#1F2937] pt-2">
                      <span>UTR:</span>
                      <span className="font-mono text-white bg-[#0A0A0F] px-2 py-0.5 rounded border border-[#1F2937]">
                        {record.utr_number}
                      </span>
                    </div>

                    {record.admin_note && (
                      <div className="text-xs rounded bg-white/[0.02] p-2 border border-[#1F2937]">
                        <span className="text-[#9CA3AF]">Note: </span>
                        <span className={record.status === "rejected" ? "text-red-300" : "text-white"}>
                          {record.admin_note}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
