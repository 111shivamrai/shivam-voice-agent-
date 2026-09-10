"use client";

export default function ReloadButton() {
  return (
    <button
      onClick={() => window.location.reload()}
      className="mt-4 rounded-lg bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
    >
      Refresh
    </button>
  );
}
