"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Card from "@/shared/components/Card";
import PricingModal from "@/shared/components/PricingModal";

export default function PricingSettingsPage() {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [currentPricing, setCurrentPricing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncInfo, setSyncInfo] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [autoSync, setAutoSync] = useState(false);
  const [intervalHours, setIntervalHours] = useState(24);

  useEffect(() => {
    loadPricing();
    loadSyncInfo();
  }, []);

  const loadPricing = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/pricing");
      if (response.ok) {
        const data = await response.json();
        setCurrentPricing(data);
      }
    } catch (error) {
      console.error("Failed to load pricing:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadSyncInfo = async () => {
    try {
      const [syncRes, settingsRes] = await Promise.all([fetch("/api/pricing/sync"), fetch("/api/settings")]);
      if (syncRes.ok) setSyncInfo(await syncRes.json());
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        setAutoSync(!!settings.pricingAutoSyncEnabled);
        setIntervalHours(Number(settings.pricingAutoSyncIntervalHours) || 24);
      }
    } catch (error) { console.error("Failed to load pricing sync settings:", error); }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const response = await fetch("/api/pricing/sync", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to sync pricing");
      await loadPricing();
      await loadSyncInfo();
    } catch (error) {
      alert(error.message);
    } finally { setSyncing(false); }
  };

  const saveAutoSync = async (enabled = autoSync, interval = intervalHours) => {
    setAutoSync(enabled);
    setIntervalHours(interval);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pricingAutoSyncEnabled: enabled, pricingAutoSyncIntervalHours: Math.max(1, Number(interval) || 24) }),
    });
    await loadSyncInfo();
  };

  const handlePricingUpdated = () => {
    loadPricing();
  };

  // Count total models with pricing
  const getModelCount = () => {
    if (!currentPricing) return 0;
    let count = 0;
    for (const provider in currentPricing) {
      count += Object.keys(currentPricing[provider]).length;
    }
    return count;
  };

  // Get providers list
  const getProviders = () => {
    if (!currentPricing) return [];
    return Object.keys(currentPricing).sort();
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Pricing Settings</h1>
          <p className="text-text-muted mt-1">
            Configure pricing rates for cost tracking and calculations
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={syncNow} disabled={syncing} className="px-4 py-2 border border-border rounded hover:bg-bg-hover transition-colors disabled:opacity-50">{syncing ? "Updating..." : "Update from OpenCode"}</button>
          <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors">Edit Pricing</button>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div><h2 className="font-semibold">Automatic price updates</h2><p className="text-sm text-text-muted">Fetch supported model prices from the OpenCode Go pricing table.</p>{syncInfo?.lastSyncAt && <p className="text-xs text-text-muted mt-1">Last sync: {new Date(syncInfo.lastSyncAt).toLocaleString()} · {syncInfo.status}</p>}</div>
          <div className="flex items-center gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoSync} onChange={(e) => saveAutoSync(e.target.checked, intervalHours)} /> Enabled</label><label className="flex items-center gap-2 text-sm">Every <input type="number" min="1" value={intervalHours} onChange={(e) => setIntervalHours(e.target.value)} onBlur={() => saveAutoSync(autoSync, intervalHours)} className="w-16 rounded border border-border bg-bg-base px-2 py-1 text-right" /> hours</label></div>
        </div>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-text-muted text-sm uppercase font-semibold">
            Total Models
          </div>
          <div className="text-2xl font-bold mt-1">
            {loading ? "..." : getModelCount()}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-text-muted text-sm uppercase font-semibold">
            Providers
          </div>
          <div className="text-2xl font-bold mt-1">
            {loading ? "..." : getProviders().length}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-text-muted text-sm uppercase font-semibold">
            Status
          </div>
          <div className="text-2xl font-bold mt-1 text-success">
            {loading ? "..." : "Active"}
          </div>
        </Card>
      </div>

      {/* Info Section */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">How Pricing Works</h2>
        <div className="space-y-3 text-sm text-text-muted">
          <p>
            <strong>Cost Calculation:</strong> Costs are calculated based on token usage and pricing rates.
            Each request&apos;s cost is determined by: (input_tokens × input_rate) + (output_tokens × output_rate) + (cached_tokens × cached_rate)
          </p>
          <p>
            <strong>Pricing Format:</strong> All rates are in <strong>dollars per million tokens</strong> ($/1M tokens).
            Example: An input rate of 2.50 means $2.50 per 1,000,000 input tokens.
          </p>
          <p>
            <strong>Token Types:</strong>
          </p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li><strong>Input:</strong> Standard prompt tokens</li>
            <li><strong>Output:</strong> Completion/response tokens</li>
            <li><strong>Cached:</strong> Cached input tokens (typically 50% of input rate)</li>
            <li><strong>Reasoning:</strong> Special reasoning/thinking tokens (fallback to output rate)</li>
            <li><strong>Cache Creation:</strong> Tokens used to create cache entries (fallback to input rate)</li>
          </ul>
          <p>
            <strong>Custom Pricing:</strong> You can override default pricing for specific models.
            Reset to defaults anytime to restore standard rates.
          </p>
        </div>
      </Card>

      {/* Current Pricing Preview */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Current Pricing Overview</h2>
          <button
            onClick={() => setShowModal(true)}
            className="text-primary hover:underline text-sm"
          >
            View Full Details
          </button>
        </div>

        {loading ? (
          <div className="text-center py-4 text-text-muted">Loading pricing data...</div>
        ) : currentPricing ? (
          <div className="space-y-3">
            {Object.keys(currentPricing).slice(0, 5).map(provider => (
              <div key={provider} className="text-sm">
                <span className="font-semibold">{provider.toUpperCase()}:</span>{" "}
                <span className="text-text-muted">
                  {Object.keys(currentPricing[provider]).length} models
                </span>
              </div>
            ))}
            {Object.keys(currentPricing).length > 5 && (
              <div className="text-sm text-text-muted">
                + {Object.keys(currentPricing).length - 5} more providers
              </div>
            )}
          </div>
        ) : (
          <div className="text-text-muted">No pricing data available</div>
        )}
      </Card>

      {/* Pricing Modal */}
      {showModal && (
        <PricingModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          onSave={handlePricingUpdated}
        />
      )}
    </div>
  );
}
