"use client";

import { MOCK_INTERACTIONS } from "./components/constants";
import { StatusCard } from "./components/StatusCard";
import { InteractionTable } from "./components/InteractionTable";

export default function Home() {
  const latest = MOCK_INTERACTIONS[0];

  return (
    <>
      <StatusCard
        zone={latest.zone}
        phase={latest.phase}
        attention={latest.attention}
        conversation={latest.conversation}
        action={latest.action}
      />
      <InteractionTable interactions={MOCK_INTERACTIONS} />
    </>
  );
}