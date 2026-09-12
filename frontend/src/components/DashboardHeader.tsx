"use client";

import { usePathname } from "next/navigation";
import { User } from "lucide-react";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/how-it-works": "How it Works",
  "/dashboard/documents": "Knowledge Base",
  "/dashboard/calls": "Calls",
  "/dashboard/billing": "Billing",
  "/dashboard/settings": "Settings",
};

interface DashboardHeaderProps {
  email: string;
  businessName: string;
}

export default function DashboardHeader({
  email,
  businessName,
}: DashboardHeaderProps) {
  const pathname = usePathname();
  const title = pageTitles[pathname] ?? "Dashboard";

  return (
    <header className="flex items-center justify-between border-b border-[#1E1E2A] bg-[#0D0D14] px-6 py-4 lg:px-8">
      {/* Page title — offset on mobile for hamburger button */}
      <h1 className="pl-10 text-lg font-semibold text-white lg:pl-0">
        {title}
      </h1>

      {/* User info */}
      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium text-white">
            {businessName || "My Business"}
          </p>
          <p className="text-xs text-[#9CA3AF]">{email}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2563EB]/10 text-[#2563EB]">
          <User className="h-4 w-4" />
        </div>
      </div>
    </header>
  );
}
