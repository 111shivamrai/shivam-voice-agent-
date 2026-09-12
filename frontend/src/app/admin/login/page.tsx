"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shield, Lock, Loader2, AlertCircle } from "lucide-react";
import {
  verifyAdmin,
  getStoredAdminPassword,
  setStoredAdminPassword,
  clearStoredAdminPassword,
} from "@/lib/admin-api";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingExisting, setCheckingExisting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // If already authenticated in sessionStorage, verify with backend before redirecting
  useEffect(() => {
    let isMounted = true;

    async function checkSession() {
      const existing = getStoredAdminPassword();
      if (existing) {
        try {
          const res = await verifyAdmin(existing);
          if (res.success && isMounted) {
            router.replace("/admin");
            return;
          }
        } catch {
          clearStoredAdminPassword();
        }
      }
      if (isMounted) {
        setCheckingExisting(false);
      }
    }

    checkSession();

    return () => {
      isMounted = false;
    };
  }, [router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = password.trim();
    if (!trimmed || loading) return;

    try {
      setLoading(true);
      setError(null);

      const res = await verifyAdmin(trimmed);
      if (res.success) {
        setStoredAdminPassword(trimmed);
        router.replace("/admin");
      } else {
        setError("Incorrect password");
      }
    } catch {
      setError("Incorrect password");
    } finally {
      setLoading(false);
    }
  }

  if (checkingExisting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0A0F] text-white">
        <div className="flex items-center gap-2.5 text-sm text-[#9CA3AF]">
          <Loader2 className="h-4 w-4 animate-spin text-[#2563EB]" />
          <span>Verifying session...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0A0A0F] px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-6">
        {/* Header / Brand */}
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#2563EB]/10 text-[#2563EB]">
            <Shield className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-white">
            Admin Portal
          </h1>
          <p className="mt-1 text-xs text-[#9CA3AF]">
            Sign in with administrator credentials to manage payments and system minutes.
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-[#1F2937] bg-[#111118] p-6 sm:p-8 shadow-2xl">
          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/10 p-3.5 text-xs text-red-300"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label
                htmlFor="admin-password-input"
                className="block text-xs font-semibold uppercase tracking-wider text-white mb-2"
              >
                Admin Password
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]">
                  <Lock className="h-4 w-4" />
                </span>
                <input
                  id="admin-password-input"
                  type="password"
                  required
                  autoFocus
                  placeholder="Enter administrator password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  className="w-full rounded-lg border border-[#1F2937] bg-[#0A0A0F] pl-10 pr-3.5 py-2.5 text-sm text-white placeholder-[#9CA3AF]/40 transition-colors focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                  aria-label="Administrator Password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !password.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2563EB] py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#2563EB] disabled:cursor-not-allowed disabled:bg-[#2563EB]/40 disabled:text-white/50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <span>Sign In to Admin</span>
              )}
            </button>
          </form>
        </div>

        {/* Footer info */}
        <p className="text-center text-[11px] text-[#9CA3AF]">
          Voice AI Agent Platform &bull; Protected Administrator Area
        </p>
      </div>
    </div>
  );
}
