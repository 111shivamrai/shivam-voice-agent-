"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Coins, Bot, Phone } from "lucide-react";

interface Profile {
  business_name?: string;
  token_balance?: number;
  agent_name?: string;
  agent_language?: string;
  telnyx_number?: string;
  created_at?: string;
}

interface StatCard {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      try {
        setLoading(true);
        setError(null);
        const supabase = createClient();
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          throw userError || new Error("No authenticated user");
        }

        const { data, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();

        if (profileError) {
          throw profileError;
        }

        if (isMounted) {
          setProfile(data);
        }
      } catch {
        if (isMounted) {
          setError("Unable to load data. Please refresh.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, []);

  const statCards: StatCard[] = [
    {
      label: "Token Balance",
      value:
        profile?.token_balance !== undefined && profile?.token_balance !== null
          ? `${profile.token_balance} tokens`
          : "—",
      icon: Coins,
    },
    {
      label: "Agent Name",
      value: profile?.agent_name || "Not configured",
      icon: Bot,
    },
    {
      label: "Telnyx Number",
      value: profile?.telnyx_number || "Not assigned",
      icon: Phone,
    },
  ];

  return (
    <div>
      {/* Welcome Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white">
          Welcome back
          {!loading && profile?.business_name ? `, ${profile.business_name}` : ""}
        </h2>
        <p className="mt-1 text-sm text-[#9CA3AF]">
          Here&apos;s an overview of your account
        </p>
      </div>

      {/* 3 Stat Cards Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-[#1E1E2A] bg-[#111118] p-5 transition-colors hover:border-[#2563EB]/30"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#2563EB]/10">
                <card.icon className="h-5 w-5 text-[#2563EB]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wider text-[#9CA3AF]">
                  {card.label}
                </p>
                {loading ? (
                  <div className="mt-1 h-5 w-28 rounded bg-[#1F2937] animate-pulse" />
                ) : (
                  <p className="mt-0.5 truncate text-sm font-semibold text-white">
                    {error ? "—" : card.value}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Error state message below cards */}
      {error && (
        <p className="mt-4 text-sm font-medium text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
