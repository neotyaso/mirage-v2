"use client";

import { useStatus } from "./StatusContext";
import { Zone, Phase } from "./types";
import { Badge } from "./Badge";

interface StatusCardProps {
  zone: Zone;
  phase: Phase;
  attention: number;
  conversation: string;
  action: string;
}

export function StatusCard({ zone, phase, attention, conversation, action }: StatusCardProps) {
  const { status } = useStatus();

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Mirage #001 Status</h2>
        <Badge variant="status" value={status} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Zone</p>
          <Badge variant="zone" value={zone} />
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Phase</p>
          <Badge variant="phase" value={phase} />
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Attention</p>
          <p className="text-2xl font-bold text-gray-900">{(attention * 100).toFixed(0)}%</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Action</p>
          <p className="text-sm font-medium text-gray-900">{action}</p>
        </div>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Conversation</span>
          <span className="font-medium text-gray-900">{conversation}</span>
        </div>
      </div>
    </div>
  );
}