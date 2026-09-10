import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  Mail,
  Coins,
  Bot,
  Globe,
  Phone,
  Calendar,
} from "lucide-react";

interface ProfileCard {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const cards: ProfileCard[] = [
    {
      label: "Email",
      value: profile?.email ?? user.email ?? "—",
      icon: Mail,
    },
    {
      label: "Token Balance",
      value: String(profile?.token_balance ?? 0),
      icon: Coins,
    },
    {
      label: "Agent Name",
      value: profile?.agent_name || "Not configured",
      icon: Bot,
    },
    {
      label: "Agent Language",
      value: profile?.agent_language || "en",
      icon: Globe,
    },
    {
      label: "Telnyx Number",
      value: profile?.telnyx_number || "Not assigned",
      icon: Phone,
    },
    {
      label: "Member Since",
      value: profile?.created_at
        ? new Date(profile.created_at).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : "—",
      icon: Calendar,
    },
  ];

  return (
    <div>
      {/* Welcome */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white">
          Welcome back
          {profile?.business_name ? `, ${profile.business_name}` : ""}
        </h2>
        <p className="mt-1 text-sm text-[#9CA3AF]">
          Here&apos;s an overview of your account
        </p>
      </div>

      {/* Profile Cards Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
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
                <p className="mt-0.5 truncate text-sm font-semibold text-white">
                  {card.value}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
