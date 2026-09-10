import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";
import DashboardHeader from "@/components/DashboardHeader";
import ReloadButton from "@/components/ReloadButton";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user = null;
  let networkError = false;
  let email = "";
  let businessName = "";

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      // Confirmed no-session errors (AuthSessionMissingError or no session cookie)
      if (
        error.name === "AuthSessionMissingError" ||
        error.message?.toLowerCase().includes("auth session missing")
      ) {
        user = null;
      } else {
        // Network, timeout, connection, or service failure
        networkError = true;
      }
    } else {
      user = data?.user ?? null;
    }

    if (user) {
      email = user.email ?? "";
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();
        businessName = profile?.business_name ?? "";
      } catch {
        // Fallback gracefully if profile query fails
      }
    }
  } catch (err: unknown) {
    // If Next.js redirect was thrown, re-throw it so the redirect completes
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      typeof (err as { digest: unknown }).digest === "string" &&
      (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
    ) {
      throw err;
    }
    // Any other thrown error from createClient/getUser is a network/service failure
    networkError = true;
  }

  // Network or timeout failure: show centered full-screen error state matching dark theme
  if (networkError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#0A0A0F] px-4 text-center">
        <h2 className="text-xl font-semibold text-white">
          Unable to connect. Please refresh the page.
        </h2>
        <ReloadButton />
      </div>
    );
  }

  // Only redirect on confirmed no-session (null user)
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#0A0A0F]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <DashboardHeader email={email} businessName={businessName} />
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
