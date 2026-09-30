"use client";
import { useState, useEffect } from "react";

export default function ErrorClassificationTab({ period }) {
 const [data, setData] = useState(null);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 fetch(`/api/usage/errors?period=${period}`)
 .then(r => r.json())
 .then(setData)
 .catch(() => setData(null))
 .finally(() => setLoading(false));
 }, [period]);

 if (loading) return <div className="text-zinc-500 text-sm">Loading error data...</div>;
 if (!data || data.total === 0) return <div className="text-zinc-500 text-sm">No data available for this period.</div>;

 return (
 <div className="flex flex-col gap-4">
 {/* Summary cards */}
 <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
 <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
 <div className="text-xs text-zinc-500 uppercase tracking-wider">Total Requests</div>
 <div className="text-2xl font-semibold text-zinc-100 mt-1">{data.total.toLocaleString()}</div>
 </div>
 <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
 <div className="text-xs text-zinc-500 uppercase tracking-wider">Errors</div>
 <div className="text-2xl font-semibold text-red-400 mt-1">{data.errors.toLocaleString()}</div>
 </div>
 <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
 <div className="text-xs text-zinc-500 uppercase tracking-wider">Error Rate</div>
 <div className="text-2xl font-semibold text-amber-400 mt-1">{data.errorRate}%</div>
 </div>
 </div>

 {/* By Status */}
 <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
 <h3 className="text-sm font-medium text-zinc-300 mb-3">Errors by Status</h3>
 <div className="space-y-2">
 {Object.entries(data.byStatus)
 .sort((a, b) => b[1].count - a[1].count)
 .map(([status, info]) => (
 <div key={status} className="flex items-center justify-between">
 <span className="text-sm text-zinc-400 min-w-0 truncate">{status}</span>
 <div className="flex flex-shrink-0 items-center gap-3">
 <div className="w-32 h-2 bg-zinc-800 rounded-full overflow-hidden">
 <div className="h-full bg-zinc-500 rounded-full" style={{ width: `${(info.count / data.total) * 100}%` }} />
 </div>
 <span className="text-sm text-zinc-300 w-16 text-right">{info.count.toLocaleString()}</span>
 </div>
 </div>
 ))}
 </div>
 </div>

 {/* Top error models */}
 {data.topErrorModels.length > 0 && (
 <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
 <h3 className="text-sm font-medium text-zinc-300 mb-3">Top Error Models</h3>
 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead>
 <tr className="border-b border-zinc-800">
 <th className="text-left text-zinc-500 font-medium pb-2 whitespace-nowrap">Model</th>
 <th className="text-right text-zinc-500 font-medium pb-2 whitespace-nowrap">Errors</th>
 <th className="text-right text-zinc-500 font-medium pb-2 whitespace-nowrap">Tokens</th>
 </tr>
 </thead>
 <tbody>
 {data.topErrorModels.map((m, i) => (
 <tr key={i} className="border-b border-zinc-800/50">
 <td className="max-w-[200px] truncate py-2 text-zinc-200">{m.model}</td>
 <td className="py-2 text-right text-red-400">{m.errors.toLocaleString()}</td>
 <td className="py-2 text-right text-zinc-400">{m.totalTokens.toLocaleString()}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 )}

 </div>
 );
}
