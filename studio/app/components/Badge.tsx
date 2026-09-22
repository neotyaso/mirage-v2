"use client";

import { Status, Phase, Zone } from "./types";
import { STATUS_COLORS, PHASE_COLORS, ZONE_COLORS } from "./constants";

type BadgeVariant = "status" | "phase" | "zone";
type BadgeValue = Status | Phase | Zone;

const COLORS = {
  status: STATUS_COLORS,
  phase: PHASE_COLORS,
  zone: ZONE_COLORS,
} as const;

const LABELS = {
  status: (v: Status) => (v === "ONLINE" ? "●" : "○") + " " + v,
  phase: (v: Phase) => v,
  zone: (v: Zone) => "Zone " + v,
} as const;

interface BadgeProps {
  variant: BadgeVariant;
  value: BadgeValue;
}

export function Badge({ variant, value }: BadgeProps) {
  const colors = COLORS[variant];
  const label = LABELS[variant];
  const className = variant === "status" 
    ? "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
    : "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium";
  
  return (
    <span className={`${className} ${colors[value as keyof typeof colors]} text-white`}>
      {label(value as any)}
    </span>
  );
}