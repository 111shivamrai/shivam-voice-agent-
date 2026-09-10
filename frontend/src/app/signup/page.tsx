"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Mail, Lock, Eye, EyeOff, Building2, Loader2 } from "lucide-react";
import clsx from "clsx";
import Link from "next/link";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          business_name: businessName,
        },
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // If email confirmation is enabled, show success message
    // If auto-confirm is enabled, redirect to dashboard
    setSuccess(true);
    setLoading(false);

    // Attempt redirect — works if auto-confirm is on
    setTimeout(() => {
      router.push("/dashboard");
      router.refresh();
    }, 2000);
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0A0F] px-4">
        <div className="w-full max-w-md text-center">
          <div className="rounded-xl border border-[#1E1E2A] bg-[#111118] p-8">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#2563EB]/10">
              <Mail className="h-6 w-6 text-[#2563EB]" />
            </div>
            <h2 className="text-xl font-bold text-white">Check your email</h2>
            <p className="mt-2 text-sm text-[#9CA3AF]">
              We&apos;ve sent a confirmation link to{" "}
              <span className="font-medium text-white">{email}</span>. Click it
              to activate your account.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-block text-sm font-medium text-[#2563EB] hover:text-[#3B82F6] transition-colors"
            >
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0A0A0F] px-4">
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">Voice AI Agent</h1>
          <p className="mt-2 text-sm text-[#9CA3AF]">Create your account</p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-[#1E1E2A] bg-[#111118] p-8">
          <form onSubmit={handleSignup} className="space-y-5">
            {/* Business Name */}
            <div>
              <label
                htmlFor="businessName"
                className="mb-1.5 block text-sm font-medium text-[#9CA3AF]"
              >
                Business Name
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                <input
                  id="businessName"
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Your Business"
                  className="focus-ring w-full rounded-lg border border-[#1E1E2A] bg-[#0A0A0F] py-2.5 pl-10 pr-4 text-sm text-white placeholder-[#4B5563] transition-colors focus:border-[#2563EB]"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm font-medium text-[#9CA3AF]"
              >
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@company.com"
                  className="focus-ring w-full rounded-lg border border-[#1E1E2A] bg-[#0A0A0F] py-2.5 pl-10 pr-4 text-sm text-white placeholder-[#4B5563] transition-colors focus:border-[#2563EB]"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium text-[#9CA3AF]"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="••••••••"
                  className="focus-ring w-full rounded-lg border border-[#1E1E2A] bg-[#0A0A0F] py-2.5 pl-10 pr-10 text-sm text-white placeholder-[#4B5563] transition-colors focus:border-[#2563EB]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-white"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-[#4B5563]">
                Must be at least 6 characters
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className={clsx(
                "focus-ring flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors",
                loading
                  ? "cursor-not-allowed bg-[#2563EB]/50"
                  : "bg-[#2563EB] hover:bg-[#1D4ED8]"
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                "Create Account"
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-6 text-center text-sm text-[#9CA3AF]">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-[#2563EB] hover:text-[#3B82F6] transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
