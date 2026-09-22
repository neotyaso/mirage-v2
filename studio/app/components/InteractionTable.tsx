"use client";

import { Interaction } from "./types";
import { Badge } from "./Badge";

interface InteractionTableProps {
  interactions: Interaction[];
}

export function InteractionTable({ interactions }: InteractionTableProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900">Interaction Timeline</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Time</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Zone</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Phase</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Attention</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Conversation</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {interactions.map((i) => (
              <tr key={i.id} className="hover:bg-gray-50 border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 text-sm font-mono text-gray-500">{i.time}</td>
                <td className="px-4 py-3"><Badge variant="zone" value={i.zone} /></td>
                <td className="px-4 py-3"><Badge variant="phase" value={i.phase} /></td>
                <td className="px-4 py-3 text-sm text-gray-900">{(i.attention * 100).toFixed(0)}%</td>
                <td className="px-4 py-3 text-sm text-gray-600">{i.conversation}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{i.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}