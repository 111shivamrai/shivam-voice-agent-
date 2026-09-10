import { Phone } from "lucide-react";

export default function CallsPage() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-[#2563EB]/10">
        <Phone className="h-7 w-7 text-[#2563EB]" />
      </div>
      <h2 className="text-xl font-bold text-white">Calls</h2>
      <p className="mt-2 max-w-sm text-sm text-[#9CA3AF]">
        This section is under development. You&apos;ll be able to view call
        history and analytics here.
      </p>
    </div>
  );
}
