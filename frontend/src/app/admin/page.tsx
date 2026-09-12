"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Clock,
  CheckCircle2,
  XCircle,
  IndianRupee,
  Activity,
  ArrowRight,
  RefreshCw,
  AlertTriangle,
  Zap,
} from "lucide-react";
import { useAdmin } from "@/app/admin/layout";
import {
  getAdminStats,
  getPendingPayments,
  type AdminStatsResponse,
} from "@/lib/admin-api";
import type { PaymentRequestRecord } from "@/lib/payments-api";
import AdminPendingPayments from "@/components/AdminPendingPayments";

export default function AdminOverviewPage() {
  const { adminPassword } = useAdmin();

  // Stats state
  const [stats, setStats] = useState<AdminStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Pending payments state
  const [pendingPayments, setPendingPayments] = useState<PaymentRequestRecord[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState<string | null>(null);

  // Success / Action notification
  const [actionNotification, setActionNotification] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      setStatsError(null);
      const res = await getAdminStats(adminPassword);
      setStats(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load statistics.";
      setStatsError(msg);
    } finally {
      setStatsLoading(false);
    }
  }, [adminPassword]);

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

  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        const [statsRes, pendingRes] = await Promise.allSettled([
          getAdminStats(adminPassword),
          getPendingPayments(adminPassword),
        ]);

        if (!isMounted) return;

        if (statsRes.status === "fulfilled") {
          setStats(statsRes.value);
          setStatsError(null);
        } else {
          const msg =
            statsRes.reason instanceof Error
              ? statsRes.reason.message
              : "Failed to load statistics.";
          setStatsError(msg);
        }

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
      } finally {
        if (isMounted) {
          setStatsLoading(false);
          setPendingLoading(false);
        }
      }
    }

    init();

    return () => {
      isMounted = false;
    };
  }, [adminPassword]);

  // Callback when a payment is approved or rejected
  function handlePaymentResolved(
    id: string,
    action: "approved" | "rejected",
    msg: string
  ) {
    // Remove from local list immediately
    setPendingPayments((prev) => prev.filter((p) => p.id !== id));
    // Show banner
    setActionNotification(msg);
    // Refresh stats in background
    fetchStats();
  }

  const loadAll = useCallback(() => {
    fetchStats();
    fetchPending();
  }, [fetchStats, fetchPending]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Admin Overview
          </h1>
          <p className="mt-1 text-xs text-[#9CA3AF]">
            System payment metrics, revenue summaries, and pending approvals.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={loadAll}
            disabled={statsLoading || pendingLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#1F2937] bg-[#111118] px-3.5 py-2 text-xs font-medium text-[#9CA3AF] hover:bg-white/5 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${
                statsLoading || pendingLoading ? "animate-spin" : ""
              }`}
            />
            <span>Refresh</span>
          </button>

          <Link
            href="/admin/payments"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          >
            <span>All Payments</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
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
            &times;
          </button>
        </div>
      )}

      {/* SECTION 1: STATS CARDS */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#9CA3AF]">
          Payment & Minute Statistics
        </h2>

        {statsLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3.5">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="h-24 rounded-xl border border-[#1F2937] bg-[#111118] p-4 animate-pulse"
              />
            ))}
          </div>
        ) : statsError ? (
          <div
            role="alert"
            className="flex items-center justify-between rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-300"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
              <span>{statsError}</span>
            </div>
            <button
              type="button"
              onClick={fetchStats}
              className="font-semibold underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
            {/* 1. Pending Payments */}
            <div className="rounded-xl border border-amber-500/30 bg-[#111118] p-4">
              <div className="flex items-center justify-between text-amber-400 mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider">
                  Pending
                </span>
                <Clock className="h-4 w-4" />
              </div>
              <div className="text-2xl font-extrabold text-white">
                {stats.pending_payment_count}
              </div>
              <p className="text-[11px] text-[#9CA3AF] mt-0.5">Awaiting verification</p>
            </div>

            {/* 2. Total Payments */}
            <div className="rounded-xl border border-[#1F2937] bg-[#111118] p-4">
              <div className="flex items-center justify-between text-[#9CA3AF] mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider">
                  Total
                </span>
                <Activity className="h-4 w-4" />
              </div>
              <div className="text-2xl font-extrabold text-white">
                {stats.total_payment_count}
              </div>
              <p className="text-[11px] text-[#9CA3AF] mt-0.5">Lifetime submissions</p>
            </div>

            {/* 3. Approved Payments */}
            <div className="rounded-xl border border-[#1F2937] bg-[#111118] p-4">
              <div className="flex items-center justify-between text-emerald-400 mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider">
                  Approved
                </span>
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div className="text-2xl font-extrabold text-white">
                {stats.approved_payment_count}
              </div>
              <p className="text-[11px] text-[#9CA3AF] mt-0.5">Successful orders</p>
            </div>

            {/* 4. Rejected Payments */}
            <div className="rounded-xl border border-[#1F2937] bg-[#111118] p-4">
              <div className="flex items-center justify-between text-red-400 mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider">
                  Rejected
                </span>
                <XCircle className="h-4 w-4" />
              </div>
              <div className="text-2xl font-extrabold text-white">
                {stats.rejected_payment_count}
              </div>
              <p className="text-[11px] text-[#9CA3AF] mt-0.5">Declined / invalid UTR</p>
            </div>

            {/* 5. Approved Revenue */}
            <div className="rounded-xl border border-[#1F2937] bg-[#111118] p-4">
              <div className="flex items-center justify-between text-[#2563EB] mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider">
                  Revenue
                </span>
                <IndianRupee className="h-4 w-4" />
              </div>
              <div className="text-2xl font-extrabold text-white">
                ₹{stats.total_approved_amount.toLocaleString("en-IN")}
              </div>
              <p className="text-[11px] text-[#9CA3AF] mt-0.5">Approved value</p>
            </div>

            {/* 6. Approved Minutes */}
            <div className="rounded-xl border border-[#1F2937] bg-[#111118] p-4">
              <div className="flex items-center justify-between text-emerald-400 mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider">
                  Minutes
                </span>
                <Zap className="h-4 w-4" />
              </div>
              <div className="text-2xl font-extrabold text-white">
                {stats.total_approved_minutes.toLocaleString("en-IN")}
              </div>
              <p className="text-[11px] text-[#9CA3AF] mt-0.5">Credited to clients</p>
            </div>
          </div>
        ) : null}
      </section>

      {/* SECTION 2: PENDING PAYMENTS QUICK TABLE */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Pending Payment Approvals</h2>
            <p className="text-xs text-[#9CA3AF]">
              Cross-reference UTR with bank records before approving. Approvals instantly credit talk time.
            </p>
          </div>
          {pendingPayments.length > 0 && (
            <span className="rounded-full bg-amber-500/10 border border-amber-500/30 px-3 py-0.5 text-xs font-bold text-amber-400">
              {pendingPayments.length} pending
            </span>
          )}
        </div>

        <AdminPendingPayments
          payments={pendingPayments}
          loading={pendingLoading}
          error={pendingError}
          onRefresh={fetchPending}
          onPaymentResolved={handlePaymentResolved}
        />
      </section>
    </div>
  );
}
