"use client";

import { useState, useEffect } from "react";
import Modal from "./Modal";
import { cn } from "@/shared/utils/cn";

export default function TimeRangeModal({ isOpen, onClose, currentRange, onRangeChange }) {
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Reset custom dates when modal opens
  useEffect(() => {
    if (isOpen) {
      if (typeof currentRange === "object" && currentRange.type === "custom") {
        setCustomFrom(currentRange.startDate || "");
        setCustomTo(currentRange.endDate || "");
      } else {
        setCustomFrom("");
        setCustomTo("");
      }
    }
  }, [isOpen, currentRange]);

  const quickRanges = [
    { value: "5m", label: "5m" },
    { value: "15m", label: "15m" },
    { value: "30m", label: "30m" },
    { value: "1h", label: "1h" },
  ];

  const extendedRanges = [
    { value: "24h", label: "24h" },
    { value: "48h", label: "48h" },
    { value: "7d", label: "7d" },
    { value: "30d", label: "30d" },
  ];

  const isSelected = (value) => {
    if (typeof currentRange === "object") {
      return false;
    }
    return currentRange === value;
  };

  const handleRangeSelect = (value) => {
    onRangeChange(value);
    onClose();
  };

  const handleCustomApply = () => {
    if (customFrom && customTo) {
      onRangeChange({
        type: "custom",
        startDate: customFrom,
        endDate: customTo,
      });
      onClose();
    }
  };

  const formatDatetimeLocal = (date) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Select Time Range"
      size="md"
      closeOnOverlay={true}
      showCloseButton={true}
    >
      <div className="flex flex-col gap-6">
        {/* Quick Ranges */}
        <div>
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
            Quick Ranges
          </h3>
          <div className="grid grid-cols-4 gap-2">
            {quickRanges.map((range) => (
              <button
                key={range.value}
                onClick={() => handleRangeSelect(range.value)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-all border",
                  isSelected(range.value)
                    ? "bg-primary text-white border-primary shadow-sm"
                    : "bg-bg-subtle text-text hover:bg-bg-hover border-border"
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        {/* Extended Ranges */}
        <div>
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
            Extended Ranges
          </h3>
          <div className="grid grid-cols-4 gap-2">
            {extendedRanges.map((range) => (
              <button
                key={range.value}
                onClick={() => handleRangeSelect(range.value)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-all border",
                  isSelected(range.value)
                    ? "bg-primary text-white border-primary shadow-sm"
                    : "bg-bg-subtle text-text hover:bg-bg-hover border-border"
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        {/* All Time */}
        <div>
          <button
            onClick={() => handleRangeSelect("all")}
            className={cn(
              "w-full px-4 py-2 rounded-lg text-sm font-medium transition-all border",
              isSelected("all")
                ? "bg-primary text-white border-primary shadow-sm"
                : "bg-bg-subtle text-text hover:bg-bg-hover border-border"
            )}
          >
            All Time
          </button>
        </div>

        {/* Custom Range */}
        <div>
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
            Custom Range
          </h3>
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5">
                From
              </label>
              <input
                type="datetime-local"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                max={formatDatetimeLocal(new Date())}
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5">
                To
              </label>
              <input
                type="datetime-local"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                max={formatDatetimeLocal(new Date())}
                min={customFrom}
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <button
              onClick={handleCustomApply}
              disabled={!customFrom || !customTo}
              className={cn(
                "w-full px-4 py-2 rounded-lg text-sm font-medium transition-all",
                customFrom && customTo
                  ? "bg-primary text-white hover:bg-primary/90"
                  : "bg-bg-subtle text-text-muted cursor-not-allowed opacity-50"
              )}
            >
              Apply Custom Range
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
