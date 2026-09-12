"use client";

import { useEffect, useState, useCallback } from "react";
import {
  CreditCard,
  Clock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Copy,
  Check,
  X,
  ArrowRight,
  ShieldAlert,
  Zap,
} from "lucide-react";
import clsx from "clsx";
import {
  getClientBalance,
  getClientPaymentHistory,
  submitPaymentRequest,
  type PaymentRequestRecord,
} from "@/lib/payments-api";

// Locked UPI configuration
const UPI_ID = "7067682667@ybl";
const QR_IMAGE_PATH = "/phonepe-qr.png";

// Locked pricing plans
interface PricingPlan {
  id: string;
  amount: number;
  minutes: number;
  label: string;
  tag?: string;
  highlighted?: boolean;
}

const PRESET_PLANS: PricingPlan[] = [
  {
    id: "plan-200",
    amount: 200,
    minutes: 40,
    label: "Starter",
  },
  {
    id: "plan-500",
    amount: 500,
    minutes: 100,
    label: "Professional",
    tag: "Popular",
    highlighted: true,
  },
  {
    id: "plan-1000",
    amount: 1000,
    minutes: 200,
    label: "Business",
  },
  {
    id: "plan-2000",
    amount: 2000,
    minutes: 400,
    label: "Enterprise",
  },
];

/**
 * Natural duration formatting helper:
 * 60 -> "approximately 1 hour"
 * 100 -> "approximately 1 hour 40 minutes"
 * 120 -> "approximately 2 hours"
 */
function formatDuration(minutes: number): string {
  if (minutes <= 0) {
    return "0 minutes of available talk time";
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) {
    return `approximately ${remainingMinutes} ${
      remainingMinutes === 1 ? "minute" : "minutes"
    }`;
  }
  if (remainingMinutes === 0) {
    return `approximately ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `approximately ${hours} ${hours === 1 ? "hour" : "hours"} ${remainingMinutes} ${
    remainingMinutes === 1 ? "minute" : "minutes"
  }`;
}

/**
 * Format ISO date string nicely
 */
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

export default function BillingPage() {
  // Balance state
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  // History state
  const [history, setHistory] = useState<PaymentRequestRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Custom amount state
  const [customAmountInput, setCustomAmountInput] = useState<string>("");
  const [customError, setCustomError] = useState<string | null>(null);

  // Payment Modal State
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [selectedMinutes, setSelectedMinutes] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Modal form state
  const [utrNumber, setUtrNumber] = useState("");
  const [utrError, setUtrError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copiedUpi, setCopiedUpi] = useState(false);

  // Success feedback state
  const [pageNotification, setPageNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // 1. Fetch balance
  const fetchBalance = useCallback(async () => {
    try {
      setBalanceLoading(true);
      setBalanceError(null);
      const res = await getClientBalance();
      setBalance(res.balance);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Unable to load your balance.";
      setBalanceError(msg);
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  // 2. Fetch history
  const fetchHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      setHistoryError(null);
      const payments = await getClientPaymentHistory();
      setHistory(payments);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to load payment history.";
      setHistoryError(msg);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      try {
        setBalanceLoading(true);
        setHistoryLoading(true);
        const [balRes, histRes] = await Promise.allSettled([
          getClientBalance(),
          getClientPaymentHistory(),
        ]);

        if (isMounted) {
          if (balRes.status === "fulfilled") {
            setBalance(balRes.value.balance);
            setBalanceError(null);
          } else {
            const msg =
              balRes.reason instanceof Error
                ? balRes.reason.message
                : "Unable to load your balance.";
            setBalanceError(msg);
          }

          if (histRes.status === "fulfilled") {
            setHistory(histRes.value);
            setHistoryError(null);
          } else {
            const msg =
              histRes.reason instanceof Error
                ? histRes.reason.message
                : "Failed to load payment history.";
            setHistoryError(msg);
          }
        }
      } finally {
        if (isMounted) {
          setBalanceLoading(false);
          setHistoryLoading(false);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  // Custom amount calculation & validation
  const parsedCustomAmount = parseInt(customAmountInput.trim(), 10);
  const isCustomValid =
    !isNaN(parsedCustomAmount) &&
    parsedCustomAmount >= 100 &&
    Number.isInteger(Number(customAmountInput.trim()));
  const calculatedCustomMinutes = isCustomValid
    ? Math.floor(parsedCustomAmount / 5)
    : 0;

  function handleCustomAmountChange(val: string) {
    setCustomAmountInput(val);
    if (!val.trim()) {
      setCustomError(null);
      return;
    }
    const num = Number(val.trim());
    if (isNaN(num)) {
      setCustomError("Please enter a valid numeric amount.");
    } else if (!Number.isInteger(num)) {
      setCustomError("Amount must be a whole integer.");
    } else if (num < 100) {
      setCustomError("Minimum top-up amount is ₹100.");
    } else {
      setCustomError(null);
    }
  }

  // Open modal with selected plan
  function openPaymentModal(amount: number, minutes: number) {
    setSelectedAmount(amount);
    setSelectedMinutes(minutes);
    setUtrNumber("");
    setUtrError(null);
    setSubmitError(null);
    setCopiedUpi(false);
    setIsModalOpen(true);
  }

  // Close modal
  function closePaymentModal() {
    if (isSubmitting) return; // Prevent closing while submitting
    setIsModalOpen(false);
    setSelectedAmount(null);
    setSelectedMinutes(null);
    setUtrNumber("");
    setUtrError(null);
    setSubmitError(null);
  }

  // Validate UTR on change
  function handleUtrChange(val: string) {
    setUtrNumber(val);
    const trimmed = val.trim();
    if (!trimmed) {
      setUtrError("UTR number is required.");
      return;
    }
    if (trimmed.length < 8 || trimmed.length > 25) {
      setUtrError("UTR length must be between 8 and 25 characters.");
      return;
    }
    if (!/^[a-zA-Z0-9]+$/.test(trimmed)) {
      setUtrError("UTR must contain only alphanumeric characters (no spaces or symbols).");
      return;
    }
    setUtrError(null);
  }

  // Copy UPI ID to clipboard
  async function handleCopyUpi() {
    try {
      await navigator.clipboard.writeText(UPI_ID);
      setCopiedUpi(true);
      setTimeout(() => setCopiedUpi(false), 2500);
    } catch {
      // Fallback
    }
  }

  // Submit payment request
  async function handleSubmitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedAmount || isSubmitting) return;

    const trimmedUtr = utrNumber.trim();
    if (!trimmedUtr) {
      setUtrError("UTR number is required.");
      return;
    }
    if (trimmedUtr.length < 8 || trimmedUtr.length > 25) {
      setUtrError("UTR length must be between 8 and 25 characters.");
      return;
    }
    if (!/^[a-zA-Z0-9]+$/.test(trimmedUtr)) {
      setUtrError("UTR must contain only alphanumeric characters.");
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitError(null);

      const res = await submitPaymentRequest(selectedAmount, trimmedUtr);

      // Close modal
      setIsModalOpen(false);

      // Show success notification on page
      setPageNotification({
        type: "success",
        message: `Payment request for ₹${selectedAmount} submitted successfully (${res.minutes_requested} minutes requested). Your payment is pending admin verification.`,
      });

      // Refresh payment history and balance without artificially modifying balance
      await Promise.allSettled([fetchBalance(), fetchHistory()]);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to submit payment. Please verify your details and try again.";
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Billing & Minutes</h2>
          <p className="mt-1 text-sm text-[#9CA3AF]">
            Manage your calling minutes, top up your account with PhonePe UPI, and track your payment history.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            fetchBalance();
            fetchHistory();
          }}
          disabled={balanceLoading || historyLoading}
          className="self-start sm:self-auto inline-flex items-center gap-1.5 rounded-lg border border-[#1E1E2A] bg-[#111118] px-3.5 py-2 text-xs font-medium text-[#9CA3AF] hover:bg-white/5 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          aria-label="Refresh balance and payment history"
        >
          <RefreshCw
            className={clsx(
              "h-3.5 w-3.5",
              (balanceLoading || historyLoading) && "animate-spin"
            )}
          />
          <span>Refresh</span>
        </button>
      </div>

      {/* Global Page Notification */}
      {pageNotification && (
        <div
          role="status"
          aria-live="polite"
          className={clsx(
            "flex items-start justify-between rounded-xl p-4 text-sm border transition-all",
            pageNotification.type === "success"
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/20 bg-red-500/10 text-red-300"
          )}
        >
          <div className="flex items-start gap-3">
            {pageNotification.type === "success" ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
            )}
            <span>{pageNotification.message}</span>
          </div>
          <button
            onClick={() => setPageNotification(null)}
            className="text-inherit hover:opacity-75 transition-opacity"
            aria-label="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* SECTION 1: BALANCE OVERVIEW */}
      <section className="rounded-2xl border border-[#1E1E2A] bg-[#111118] p-6">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2563EB]/10 text-[#2563EB]">
            <Clock className="h-4 w-4" />
          </div>
          <h3 className="text-base font-semibold text-white">Current Balance</h3>
        </div>

        {balanceLoading ? (
          <div className="animate-pulse space-y-3" role="status" aria-label="Loading balance">
            <div className="h-10 w-48 rounded-lg bg-[#1F2937]" />
            <div className="h-4 w-64 rounded bg-[#1F2937]" />
          </div>
        ) : balanceError ? (
          <div
            role="alert"
            className="rounded-xl border border-red-500/20 bg-red-500/10 p-5 text-center sm:text-left sm:flex sm:items-center sm:justify-between gap-4"
          >
            <div>
              <p className="text-sm font-semibold text-white">Unable to load your balance.</p>
              <p className="mt-1 text-xs text-red-300">{balanceError}</p>
            </div>
            <button
              type="button"
              onClick={fetchBalance}
              className="mt-3 sm:mt-0 inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Retry</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold tracking-tight text-white">
                  {balance ?? 0}
                </span>
                <span className="text-lg font-medium text-[#9CA3AF]">minutes</span>
              </div>
              <p className="mt-2 text-sm text-[#9CA3AF] flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Talk time available:{" "}
                <span className="text-white font-medium">
                  {formatDuration(balance ?? 0)}
                </span>
              </p>
            </div>

            <div className="rounded-xl border border-[#1E1E2A] bg-[#0A0A0F] p-4 text-xs text-[#9CA3AF] max-w-sm">
              <div className="flex items-center gap-2 text-white font-medium mb-1">
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                <span>Rate & Usage</span>
              </div>
              Minutes are deducted strictly based on live voice call duration. Top-up anytime via PhonePe QR.
            </div>
          </div>
        )}
      </section>

      {/* SECTION 2: PRICING PLANS */}
      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Select Minute Package</h3>
          <p className="text-xs text-[#9CA3AF] mt-0.5">
            Flat locked rate of ₹5 per minute (minimum ₹100). Choose a preset plan or enter a custom amount.
          </p>
        </div>

        {/* Preset Plan Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PRESET_PLANS.map((plan) => (
            <div
              key={plan.id}
              className={clsx(
                "relative flex flex-col justify-between rounded-xl border p-5 transition-all",
                plan.highlighted
                  ? "border-[#2563EB] bg-[#111118] ring-1 ring-[#2563EB]/50 shadow-lg shadow-[#2563EB]/5"
                  : "border-[#1E1E2A] bg-[#111118] hover:border-[#2563EB]/40 hover:bg-[#151520]"
              )}
            >
              {plan.tag && (
                <span className="absolute -top-2.5 right-4 rounded-full bg-[#2563EB] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                  {plan.tag}
                </span>
              )}

              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">
                  {plan.label}
                </div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold text-white">
                    ₹{plan.amount.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="mt-2 rounded-lg bg-[#0A0A0F] p-2.5 text-center">
                  <div className="text-lg font-bold text-emerald-400">
                    {plan.minutes} Minutes
                  </div>
                  <div className="text-[11px] text-[#9CA3AF]">
                    {formatDuration(plan.minutes)}
                  </div>
                </div>
                <div className="mt-3 text-xs text-[#9CA3AF] text-center">
                  ₹5 per call minute
                </div>
              </div>

              <button
                type="button"
                onClick={() => openPaymentModal(plan.amount, plan.minutes)}
                className={clsx(
                  "mt-5 flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-[#2563EB]",
                  plan.highlighted
                    ? "bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                    : "bg-white/10 text-white hover:bg-white/15 border border-[#1E1E2A]"
                )}
              >
                <span>Select Plan</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Custom Amount Card */}
        <div className="rounded-xl border border-[#1E1E2A] bg-[#111118] p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="max-w-md">
              <h4 className="text-sm font-semibold text-white">Custom Amount</h4>
              <p className="mt-0.5 text-xs text-[#9CA3AF]">
                Need a specific number of minutes? Enter any amount (minimum ₹100, ₹5 per minute).
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-[#9CA3AF]">
                  ₹
                </span>
                <input
                  type="number"
                  min="100"
                  step="1"
                  placeholder="e.g. 750"
                  value={customAmountInput}
                  onChange={(e) => handleCustomAmountChange(e.target.value)}
                  className="w-full sm:w-44 rounded-lg border border-[#1E1E2A] bg-[#0A0A0F] pl-7 pr-3 py-2 text-sm text-white placeholder-[#9CA3AF]/40 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                  aria-label="Custom payment amount in rupees"
                />
              </div>

              <button
                type="button"
                disabled={!isCustomValid}
                onClick={() => {
                  if (isCustomValid) {
                    openPaymentModal(parsedCustomAmount, calculatedCustomMinutes);
                  }
                }}
                className={clsx(
                  "inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-[#2563EB]",
                  isCustomValid
                    ? "bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                    : "bg-white/5 text-[#9CA3AF] cursor-not-allowed border border-[#1E1E2A]"
                )}
              >
                <span>Pay ₹{isCustomValid ? parsedCustomAmount : "—"}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Inline Preview / Validation Messages */}
          {customError ? (
            <p className="mt-2 text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{customError}</span>
            </p>
          ) : isCustomValid ? (
            <p className="mt-2 text-xs text-emerald-400 flex items-center gap-1">
              <Check className="h-3.5 w-3.5 shrink-0" />
              <span>
                ₹{parsedCustomAmount} gives <strong>{calculatedCustomMinutes} minutes</strong> ({formatDuration(calculatedCustomMinutes)})
              </span>
            </p>
          ) : null}
        </div>
      </section>

      {/* SECTION 3: PAYMENT HISTORY */}
      <section className="rounded-2xl border border-[#1E1E2A] bg-[#111118] p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2563EB]/10 text-[#2563EB]">
              <CreditCard className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Payment History</h3>
              <p className="text-xs text-[#9CA3AF]">
                All submitted payment requests and their manual verification status.
              </p>
            </div>
          </div>

          {!historyLoading && !historyError && (
            <span className="rounded-full bg-[#1E1E2A] px-2.5 py-0.5 text-xs font-medium text-[#9CA3AF]">
              {history.length} {history.length === 1 ? "record" : "records"}
            </span>
          )}
        </div>

        {/* Loading State */}
        {historyLoading && (
          <div className="space-y-3" role="status" aria-label="Loading payment history">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border border-[#1E1E2A] bg-[#0A0A0F] p-4 animate-pulse"
              >
                <div className="space-y-2">
                  <div className="h-4 w-32 rounded bg-[#1F2937]" />
                  <div className="h-3 w-48 rounded bg-[#1F2937]" />
                </div>
                <div className="h-6 w-20 rounded-full bg-[#1F2937]" />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {!historyLoading && historyError && (
          <div
            role="alert"
            className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-center"
          >
            <AlertCircle className="mx-auto h-7 w-7 text-red-400" />
            <p className="mt-2 text-sm font-semibold text-white">
              Failed to load payment history
            </p>
            <p className="mt-1 text-xs text-red-300">{historyError}</p>
            <button
              type="button"
              onClick={fetchHistory}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try Again
            </button>
          </div>
        )}

        {/* Empty State */}
        {!historyLoading && !historyError && history.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[#2563EB]/10 text-[#2563EB]">
              <CreditCard className="h-6 w-6" />
            </div>
            <h4 className="text-sm font-semibold text-white">No payment history yet</h4>
            <p className="mt-1 max-w-sm text-xs text-[#9CA3AF]">
              Purchased minutes will appear here after submitting a payment request.
            </p>
          </div>
        )}

        {/* Populated History: Desktop Table & Mobile Cards */}
        {!historyLoading && !historyError && history.length > 0 && (
          <div>
            {/* Desktop Table View (sm and up) */}
            <div className="hidden sm:block overflow-x-auto rounded-lg border border-[#1E1E2A]">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#1E1E2A] bg-[#0A0A0F] text-[#9CA3AF] uppercase font-semibold">
                  <tr>
                    <th scope="col" className="px-4 py-3">Date</th>
                    <th scope="col" className="px-4 py-3">Amount</th>
                    <th scope="col" className="px-4 py-3">Minutes</th>
                    <th scope="col" className="px-4 py-3">UTR / Ref No.</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E1E2A] bg-[#0A0A0F]/60">
                  {history.map((record) => (
                    <tr key={record.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 text-white whitespace-nowrap">
                        {formatDate(record.created_at)}
                      </td>
                      <td className="px-4 py-3 font-semibold text-white whitespace-nowrap">
                        ₹{record.amount.toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3 font-medium text-emerald-400 whitespace-nowrap">
                        +{record.minutes_requested} mins
                      </td>
                      <td className="px-4 py-3 font-mono text-[#9CA3AF] whitespace-nowrap">
                        {record.utr_number}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {record.status === "pending" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                            Pending Approval
                          </span>
                        )}
                        {record.status === "approved" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
                            <Check className="h-3 w-3" />
                            Approved
                          </span>
                        )}
                        {record.status === "rejected" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-0.5 text-[11px] font-medium text-red-400">
                            <X className="h-3 w-3" />
                            Rejected
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[#9CA3AF] max-w-xs truncate">
                        {record.admin_note ? (
                          <span className={record.status === "rejected" ? "text-red-300" : "text-[#9CA3AF]"}>
                            {record.admin_note}
                          </span>
                        ) : (
                          <span className="text-[#9CA3AF]/40">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View (below sm) */}
            <div className="sm:hidden space-y-3">
              {history.map((record) => (
                <div
                  key={record.id}
                  className="rounded-xl border border-[#1E1E2A] bg-[#0A0A0F] p-4 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#9CA3AF]">
                      {formatDate(record.created_at)}
                    </span>
                    {record.status === "pending" && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                        Pending
                      </span>
                    )}
                    {record.status === "approved" && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                        Approved
                      </span>
                    )}
                    {record.status === "rejected" && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400">
                        Rejected
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline justify-between pt-1">
                    <span className="text-base font-bold text-white">
                      ₹{record.amount.toLocaleString("en-IN")}
                    </span>
                    <span className="text-xs font-semibold text-emerald-400">
                      +{record.minutes_requested} minutes
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-[#9CA3AF] border-t border-[#1E1E2A] pt-2">
                    <span>UTR:</span>
                    <span className="font-mono text-white">{record.utr_number}</span>
                  </div>

                  {record.admin_note && (
                    <div className="text-xs rounded bg-white/[0.02] p-2 border border-[#1E1E2A]">
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

      {/* SECTION 4: PAYMENT MODAL */}
      {isModalOpen && selectedAmount && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 overflow-y-auto"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !isSubmitting) closePaymentModal();
          }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-[#1E1E2A] bg-[#111118] p-6 shadow-2xl space-y-5 my-8">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-[#1E1E2A] pb-4">
              <div>
                <h3 id="payment-modal-title" className="text-lg font-bold text-white">
                  Pay via PhonePe / UPI
                </h3>
                <p className="text-xs text-[#9CA3AF] mt-0.5">
                  Scan QR code or use UPI ID to make payment.
                </p>
              </div>
              <button
                type="button"
                onClick={closePaymentModal}
                disabled={isSubmitting}
                className="rounded-lg p-1 text-[#9CA3AF] hover:bg-white/5 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                aria-label="Close payment modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Amount Summary Card */}
            <div className="flex items-center justify-between rounded-xl border border-[#2563EB]/30 bg-[#2563EB]/10 p-4">
              <div>
                <span className="text-xs text-[#9CA3AF] uppercase font-semibold">
                  Payment Amount
                </span>
                <div className="text-2xl font-extrabold text-white">
                  ₹{selectedAmount.toLocaleString("en-IN")}
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs text-[#9CA3AF] uppercase font-semibold">
                  Minutes to Credit
                </span>
                <div className="text-base font-bold text-emerald-400">
                  {selectedMinutes ?? Math.floor(selectedAmount / 5)} Minutes
                </div>
              </div>
            </div>

            {/* PhonePe QR Image Display */}
            <div className="flex flex-col items-center justify-center p-3 rounded-xl border border-[#1E1E2A] bg-[#0A0A0F]">
              <div className="bg-white p-3 rounded-lg shadow-inner max-w-[240px] flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={QR_IMAGE_PATH}
                  alt="PhonePe QR Code for payment"
                  className="max-h-56 w-auto object-contain rounded"
                />
              </div>
              <p className="mt-2 text-[11px] text-[#9CA3AF]">
                Scan with PhonePe, Google Pay, Paytm, or BHIM
              </p>
            </div>

            {/* UPI ID Copy Bar */}
            <div className="rounded-xl border border-[#1E1E2A] bg-[#0A0A0F] p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-medium">
                  UPI ID
                </div>
                <div className="font-mono text-sm font-semibold text-white truncate">
                  {UPI_ID}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyUpi}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-[#2563EB]",
                  copiedUpi
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : "bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                )}
                aria-label="Copy UPI ID"
              >
                {copiedUpi ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>UPI ID copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy UPI ID</span>
                  </>
                )}
              </button>
            </div>

            {/* Instructions */}
            <div className="rounded-lg bg-white/[0.02] border border-[#1E1E2A] p-3 text-xs text-[#9CA3AF] space-y-1">
              <p className="font-semibold text-white">Payment Steps:</p>
              <ol className="list-decimal list-inside space-y-0.5 text-[11px] leading-relaxed">
                <li>Scan the QR code using any UPI app.</li>
                <li>Pay the exact amount shown: <strong className="text-white">₹{selectedAmount}</strong>.</li>
                <li>Copy the 12-digit UTR / transaction reference number from your receipt.</li>
                <li>Paste the UTR number below and submit.</li>
              </ol>
            </div>

            {/* Submission Form */}
            <form onSubmit={handleSubmitPayment} className="space-y-4">
              <div>
                <label
                  htmlFor="utr-input"
                  className="block text-xs font-semibold uppercase tracking-wider text-white mb-1.5"
                >
                  Enter UTR / Transaction Reference Number <span className="text-red-400">*</span>
                </label>
                <input
                  id="utr-input"
                  type="text"
                  maxLength={25}
                  placeholder="e.g. 202609121234 or TXN12345678"
                  value={utrNumber}
                  onChange={(e) => handleUtrChange(e.target.value)}
                  disabled={isSubmitting}
                  className={clsx(
                    "w-full rounded-lg border bg-[#0A0A0F] px-3.5 py-2.5 font-mono text-sm text-white placeholder-[#9CA3AF]/40 transition-colors focus:outline-none focus:ring-2",
                    utrError
                      ? "border-red-500 focus:ring-red-500"
                      : "border-[#1E1E2A] focus:border-[#2563EB] focus:ring-[#2563EB]"
                  )}
                  aria-invalid={Boolean(utrError)}
                  aria-describedby={utrError ? "utr-error" : undefined}
                />
                {utrError && (
                  <p id="utr-error" className="mt-1 text-xs text-red-400 flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>{utrError}</span>
                  </p>
                )}
              </div>

              {/* Submit Error */}
              {submitError && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300 flex items-start gap-2"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* Notice */}
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-[11px] text-amber-300">
                <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                <span>
                  <strong>Manual Verification:</strong> Payments are verified manually by an administrator.
                  Your minutes balance will not increase until the payment request is verified and approved.
                </span>
              </div>

              {/* Modal Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={closePaymentModal}
                  className="rounded-lg border border-[#1E1E2A] px-4 py-2 text-xs font-medium text-[#9CA3AF] hover:bg-white/5 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !utrNumber.trim() || Boolean(utrError)}
                  className={clsx(
                    "inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2 text-xs font-semibold text-white transition-all focus:outline-none focus:ring-2 focus:ring-[#2563EB]",
                    isSubmitting || !utrNumber.trim() || Boolean(utrError)
                      ? "bg-[#2563EB]/40 cursor-not-allowed text-white/50"
                      : "bg-[#2563EB] hover:bg-[#1D4ED8]"
                  )}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <span>Submit Payment Request</span>
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
