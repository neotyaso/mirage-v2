"use client";

import { useStatus } from "./StatusContext";
import { Badge } from "./Badge";

export function Header() {
  const { status, toggleStatus } = useStatus();

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <Badge variant="status" value={status} />
      </div>
      <button
        onClick={toggleStatus}
        className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
      >
        {status === "ONLINE" ? "Set Offline" : "Set Online"}
      </button>
    </header>
  );
}