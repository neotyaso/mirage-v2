"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Header } from "./components/Header";
import { StatusProvider } from "./components/StatusContext";

const navItems = [
  { name: "Dashboard", href: "/" },
  { name: "Sessions", href: "/sessions" },
  { name: "Settings", href: "/settings" },
];

function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-gray-900 text-white min-h-screen flex flex-col">
      <div className="p-6 border-b border-gray-700">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <span className="text-green-400">◆</span> MIRAGE Studio
        </h1>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-gray-700 text-white"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              }`}
            >
              {item.name}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-gray-700 text-xs text-gray-500">
        v0.1.0-dev
      </div>
    </aside>
  );
}

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <StatusProvider>
      <div className="min-h-screen bg-gray-50 flex">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          <Header />
          <div className="flex-1 p-6 overflow-auto">
            <div className="max-w-7xl mx-auto space-y-6">
              {children}
            </div>
          </div>
        </main>
      </div>
    </StatusProvider>
  );
}