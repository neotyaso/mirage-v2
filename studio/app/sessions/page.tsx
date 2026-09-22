"use client";

import { MOCK_INTERACTIONS } from "@/app/components/constants";
import { InteractionTable } from "@/app/components/InteractionTable";

export default function SessionsPage() {
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Sessions</h1>
      </div>
      <InteractionTable interactions={MOCK_INTERACTIONS} />
    </>
  );
}