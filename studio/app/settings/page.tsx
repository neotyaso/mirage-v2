"use client";

export default function SettingsPage() {
  return (
    <>
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm mt-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">一般設定</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mirage ID</label>
            <input
              type="text"
              defaultValue="mirage-001"
              className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">WebSocket URL</label>
            <input
              type="text"
              defaultValue="ws://localhost:8080"
              className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ポーリング間隔 (ms)</label>
            <input
              type="number"
              defaultValue="1000"
              className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        </div>
      </div>
    </>
  );
}