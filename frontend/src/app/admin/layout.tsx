"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Shield,
  LayoutDashboard,
  CreditCard,
  LogOut,
  Loader2,
  Menu,
  X,
} from "lucide-react";
import clsx from "clsx";
import {
  getStoredAdminPassword,
  clearStoredAdminPassword,
  verifyAdmin,
} from "@/lib/admin-api";

interface AdminContextValue {
  adminPassword: string;
  logout: () => void;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) {
    throw new Error("useAdmin must be used within an AdminLayout");
  }
  return ctx;
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const isLoginPage = pathname === "/admin/login";
  const [password, setPassword] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(!isLoginPage);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = useCallback(() => {
    clearStoredAdminPassword();
    setPassword(null);
    router.replace("/admin/login");
  }, [router]);

  useEffect(() => {
    // If we're on the login page, no verification is needed in layout
    if (isLoginPage) {
      return;
    }

    let isMounted = true;

    async function checkAuth() {
      const stored = getStoredAdminPassword();
      if (!stored) {
        if (isMounted) {
          router.replace("/admin/login");
        }
        return;
      }

      try {
        const res = await verifyAdmin(stored);
        if (res.success && isMounted) {
          setPassword(stored);
          setVerifying(false);
        } else {
          clearStoredAdminPassword();
          if (isMounted) {
            router.replace("/admin/login");
          }
        }
      } catch {
        clearStoredAdminPassword();
        if (isMounted) {
          router.replace("/admin/login");
        }
      }
    }

    checkAuth();

    return () => {
      isMounted = false;
    };
  }, [isLoginPage, router]);

  // If this is the login page, render children directly without admin chrome
  if (isLoginPage) {
    return <>{children}</>;
  }

  // Loading state while verifying credentials with backend
  if (verifying || !password) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0A0F] text-white">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-[#2563EB]" />
          <p className="text-xs text-[#9CA3AF]">Verifying administrator credentials...</p>
        </div>
      </div>
    );
  }

  const navItems = [
    {
      label: "Overview",
      href: "/admin",
      icon: LayoutDashboard,
      active: pathname === "/admin",
    },
    {
      label: "Payments",
      href: "/admin/payments",
      icon: CreditCard,
      active: pathname.startsWith("/admin/payments"),
    },
  ];

  return (
    <AdminContext.Provider value={{ adminPassword: password, logout: handleLogout }}>
      <div className="min-h-screen bg-[#0A0A0F] text-white">
        {/* Top Navbar */}
        <header className="sticky top-0 z-40 border-b border-[#1F2937] bg-[#111118]/90 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            {/* Brand */}
            <div className="flex items-center gap-3">
              <Link
                href="/admin"
                className="flex items-center gap-2.5 transition-opacity hover:opacity-90"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2563EB]">
                  <Shield className="h-5 w-5 text-white" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-white tracking-tight">
                    Voice AI
                  </span>
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-[#2563EB]">
                    Admin Console
                  </span>
                </div>
              </Link>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden sm:flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#2563EB]",
                    item.active
                      ? "bg-[#2563EB] text-white"
                      : "text-[#9CA3AF] hover:bg-white/5 hover:text-white"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>

            {/* Right Action: Logout */}
            <div className="hidden sm:flex items-center gap-3">
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-1.5 rounded-lg border border-[#1F2937] px-3 py-1.5 text-xs font-medium text-[#9CA3AF] hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                aria-label="Sign out of admin console"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            </div>

            {/* Mobile menu button */}
            <div className="sm:hidden flex items-center">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="rounded-lg p-2 text-[#9CA3AF] hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                aria-label="Toggle navigation menu"
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {/* Mobile Navigation Drawer */}
          {mobileMenuOpen && (
            <div className="sm:hidden border-t border-[#1F2937] bg-[#111118] px-4 py-3 space-y-2">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={clsx(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
                    item.active
                      ? "bg-[#2563EB] text-white"
                      : "text-[#9CA3AF] hover:bg-white/5 hover:text-white"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              ))}
              <div className="pt-2 border-t border-[#1F2937]">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    handleLogout();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </header>

        {/* Main Content */}
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </AdminContext.Provider>
  );
}
