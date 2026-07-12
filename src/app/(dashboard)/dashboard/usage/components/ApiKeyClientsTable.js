"use client";

import Badge from "@/shared/components/Badge";
import Card from "@/shared/components/Card";
import { fmt, fmtTime } from "./UsageTable";

const SOURCE_LABELS = {
  socket: "Direct",
  cloudflare: "Quick Tunnel",
  "cloudflare-worker": "Short Tunnel",
  "reverse-proxy": "Reverse Proxy",
  unknown: "Unknown",
};

export default function ApiKeyClientsTable({ clients = [], summaries = [] }) {
  const summaryMap = new Map(summaries.map((summary) => [summary.apiKeyId, summary]));

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-bg-subtle/30 text-xs uppercase text-text-muted">
            <tr>
              <th className="px-4 py-3">API Key</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Network</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3 text-right">Requests</th>
              <th className="px-4 py-3 text-right">Tokens</th>
              <th className="px-4 py-3 text-right">First Seen</th>
              <th className="px-4 py-3 text-right">Last Seen</th>
              <th className="px-4 py-3 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {clients.map((client) => {
              const summary = summaryMap.get(client.apiKeyId);
              const review = client.active && summary?.risk === "review";
              const totalTokens = client.promptTokens + client.completionTokens;
              return (
                <tr key={`${client.apiKeyId}-${client.fingerprint}`} className="hover:bg-bg-subtle/20">
                  <td className="px-4 py-3">
                    <div className="font-medium">{client.keyName}</div>
                    <div className="text-xs text-text-muted">
                      {summary?.activeClients || 0} active / {summary?.distinctClients || 0} seen
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{client.clientLabel}</div>
                    <div className="font-mono text-xs text-text-muted">{client.fingerprint}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{client.maskedNetwork}</td>
                  <td className="px-4 py-3">{SOURCE_LABELS[client.ipSource] || client.ipSource}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmt(client.requests)}</td>
                  <td
                    className="px-4 py-3 text-right tabular-nums"
                    title={`Input ${fmt(client.promptTokens)}, output ${fmt(client.completionTokens)}, reasoning ${fmt(client.reasoningTokens)}`}
                  >
                    {fmt(totalTokens)}
                  </td>
                  <td className="px-4 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(client.firstSeen)}</td>
                  <td className="px-4 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(client.lastSeen)}</td>
                  <td className="px-4 py-3 text-right">
                    <Badge
                      variant={review ? "warning" : client.active ? "success" : "default"}
                      size="sm"
                      dot
                    >
                      {review ? "Review" : client.active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                </tr>
              );
            })}
            {clients.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-text-muted">
                  No API key client activity for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
