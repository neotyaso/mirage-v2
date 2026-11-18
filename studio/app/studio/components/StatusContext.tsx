"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import { Status } from "./types";

interface StatusContextType {
  status: Status;
  toggleStatus: () => void;
}

const StatusContext = createContext<StatusContextType | null>(null);

export function StatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("OFFLINE");
  const toggleStatus = () => setStatus((c) => (c === "OFFLINE" ? "ONLINE" : "OFFLINE"));

  return (
    <StatusContext.Provider value={{ status, toggleStatus }}>
      {children}
    </StatusContext.Provider>
  );
}

export function useStatus() {
  const ctx = useContext(StatusContext);
  if (!ctx) throw new Error("useStatus must be used within StatusProvider");
  return ctx;
}