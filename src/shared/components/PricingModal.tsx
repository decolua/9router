"use client";

import React, { useState, useEffect } from "react";
import { getDefaultPricing } from "@/shared/constants/pricing";
import { X, FloppyDisk, ArrowsClockwise, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { translate } from "@/i18n/runtime";

interface PricingModelData {
  input: number;
  output: number;
  cached?: number;
  reasoning?: number;
  cache_creation?: number;
  [key: string]: number | undefined;
}

interface PricingProviderData {
  [model: string]: PricingModelData;
}

interface PricingData {
  [provider: string]: PricingProviderData;
}

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
}

export default function PricingModal({ isOpen, onClose, onSave }: PricingModalProps) {
  const [pricingData, setPricingData] = useState<PricingData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadPricing = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/pricing");
      if (response.ok) {
        const data = await response.json();
        setPricingData(data);
      } else {
        // Fallback to defaults
        const defaults = getDefaultPricing();
        setPricingData(defaults as any);
      }
    } catch (error) {
      console.error("Failed to load pricing:", error);
      const defaults = getDefaultPricing();
      setPricingData(defaults as any);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadPricing();
    }
  }, [isOpen]);

  const handlePricingChange = (provider: string, model: string, field: string, value: string) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) return;

    setPricingData(prev => {
      const newData = { ...prev };
      if (!newData[provider]) newData[provider] = {};
      if (!newData[provider][model]) newData[provider][model] = { input: 0, output: 0 };
      newData[provider][model][field] = numValue;
      return newData;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pricingData)
      });

      if (response.ok) {
        onSave?.();
        onClose();
      } else {
        const error = await response.json();
        alert(`Failed to save pricing: ${error.error}`);
      }
    } catch (error) {
      console.error("Failed to save pricing:", error);
      alert("Failed to save pricing");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm(translate("Reset all pricing to defaults? This cannot be undone."))) return;

    try {
      const response = await fetch("/api/pricing", { method: "DELETE" });
      if (response.ok) {
        const defaults = getDefaultPricing();
        setPricingData(defaults as any);
      }
    } catch (error) {
      console.error("Failed to reset pricing:", error);
      alert("Failed to reset pricing");
    }
  };

  if (!isOpen) return null;

  // Get all unique providers and models for display
  const allProviders = Object.keys(pricingData).sort();
  const pricingFields = ["input", "output", "cached", "reasoning", "cache_creation"];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-background border border-border/50 rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col scale-100 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 border-b border-border/50 flex items-center justify-between bg-muted/5">
          <div className="flex flex-col gap-0.5 pl-2">
            <h2 className="text-lg font-bold tracking-tight text-foreground">Infrastructure Pricing</h2>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-50">Configure upstream cost metrics</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted/10 transition-colors"
          >
            <X className="size-5" weight="bold" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 bg-background custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
              <Spinner className="size-8 animate-spin text-primary" />
              <p className="text-xs font-bold uppercase tracking-widest animate-pulse">Syncing price books...</p>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Instructions */}
              <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 flex items-start gap-3">
                <Warning className="size-5 text-primary shrink-0 mt-0.5" weight="bold" />
                <div className="space-y-1">
                   <p className="text-xs font-bold text-primary uppercase tracking-widest">Pricing Rates Format</p>
                   <p className="text-[11px] text-primary/80 font-medium leading-relaxed italic">
                    All rates are in <strong>dollars per million tokens</strong> ($/1M tokens).
                    Example: Input rate of 2.50 means $2.50 per 1,000,000 input tokens.
                   </p>
                </div>
              </div>

              {/* Pricing Tables */}
              {allProviders.map(provider => {
                const models = Object.keys(pricingData[provider]).sort();
                return (
                  <div key={provider} className="border border-border/50 rounded-xl overflow-hidden bg-muted/5">
                    <div className="bg-muted/10 px-4 py-2.5 font-bold text-[10px] uppercase tracking-[0.2em] text-muted-foreground border-b border-border/50">
                      {provider}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs font-mono">
                        <thead className="bg-muted/5 text-muted-foreground font-bold uppercase text-[9px] tracking-widest border-b border-border/30">
                          <tr>
                            <th className="px-4 py-3 text-left">Model Identity</th>
                            <th className="px-4 py-3 text-right">In</th>
                            <th className="px-4 py-3 text-right">Out</th>
                            <th className="px-4 py-3 text-right">Cached</th>
                            <th className="px-4 py-3 text-right">Think</th>
                            <th className="px-4 py-3 text-right">C-Create</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                          {models.map(model => (
                            <tr key={model} className="hover:bg-muted/30 transition-colors group">
                              <td className="px-4 py-2.5 font-bold text-foreground truncate max-w-[200px]" title={model}>{model}</td>
                              {pricingFields.map(field => (
                                <td key={field} className="px-4 py-2.5 text-right">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={pricingData[provider][model][field] || 0}
                                    onChange={(e) => handlePricingChange(provider, model, field, e.target.value)}
                                    className="w-16 px-1.5 py-1 text-right bg-background border border-border/50 rounded-none text-[11px] font-bold tabular-nums focus:outline-none focus:border-primary/50 transition-colors group-hover:border-primary/30"
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

              {allProviders.length === 0 && (
                <div className="py-20 text-center opacity-30 flex flex-col items-center gap-2">
                   <Warning className="size-10" />
                   <p className="text-[10px] font-bold uppercase tracking-widest">No pricing records found</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border/50 flex items-center justify-between gap-3 bg-muted/5">
          <Button
            variant="ghost"
            onClick={handleReset}
            className="h-9 px-4 text-[10px] font-bold uppercase tracking-widest text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={saving}
          >
            <ArrowsClockwise className="size-3.5 mr-1.5" weight="bold" />
            Reset Defaults
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-9 px-4 text-[10px] font-bold uppercase tracking-widest border-border/50"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              className="h-9 px-6 text-[10px] font-bold uppercase tracking-widest shadow-none"
              disabled={saving}
            >
              {saving ? <Spinner className="size-3.5" /> : <><FloppyDisk className="size-3.5 mr-2" weight="bold" /> Save Catalog</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
