"use client";

// ponytail: plain absolute/fixed positioning with bounding rect check; upgrade to @floating-ui if complex collision needed
import { useState, useRef, useEffect, useCallback } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { cn } from "@/shared/utils/cn";
import {
  PRESETS,
  computeRange,
  rangeLabel,
  getPresetBadge,
} from "./ranges.js";

const ROLLING_PRESETS = PRESETS.filter((p) => p.section === "rolling");
const CALENDAR_PRESETS = [
  ["today", "yesterday"],
  ["thisWeek", "prevWeek"],
  ["thisMonth", "prevMonth"],
];

const PRESET_LOOKUP = new Map(PRESETS.map((p) => [p.id, p]));

function formatTime(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RangePicker({
  preset = "24h",
  from = null,
  to = null,
  onChange,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState("presets"); // "presets" | "custom"

  // Time & custom range state
  const [customRange, setCustomRange] = useState(undefined);
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("23:59");
  const [now, setNow] = useState(() => Date.now());

  // Positioning
  const [popoverStyle, setPopoverStyle] = useState({});

  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  // Sync initial custom dates when opening custom view or when props change
  const syncCustomState = useCallback(() => {
    if (preset === "custom" && from && to) {
      const fDate = new Date(from);
      const tDate = new Date(to);
      setCustomRange({ from: fDate, to: tDate });
      setStartTime(formatTime(fDate));
      setEndTime(formatTime(tDate));
    } else {
      const computed = computeRange(preset, from, to, Date.now());
      setCustomRange({ from: new Date(computed.from), to: new Date(computed.to) });
      setStartTime("00:00");
      setEndTime("23:59");
    }
  }, [preset, from, to]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const isMobile = window.innerWidth < 640;
    if (isMobile) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPopoverStyle({
        position: "fixed",
        left: "8px",
        right: "8px",
        top: `${rect.bottom + 6}px`,
        maxHeight: `calc(100vh - ${rect.bottom + 16}px)`,
        overflowY: "auto",
      });
    } else {
      setPopoverStyle({
        position: "absolute",
        right: 0,
        top: "100%",
        marginTop: "6px",
        maxHeight: "85vh",
        overflowY: "auto",
      });

      // After render, check if left edge overflows viewport
      requestAnimationFrame(() => {
        if (!popoverRef.current) return;
        const rect = popoverRef.current.getBoundingClientRect();
        if (rect.left < 8) {
          setPopoverStyle((prev) => ({
            ...prev,
            right: "auto",
            left: 0,
          }));
        }
      });
    }
  }, []);

  const openPopover = () => {
    setNow(Date.now());
    setView(preset === "custom" ? "custom" : "presets");
    syncCustomState();
    setIsOpen(true);
  };

  const closePopover = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  // Reposition on open, view change, or resize
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [isOpen, view, updatePosition]);

  // Outside click & Esc key
  useEffect(() => {
    if (!isOpen) return;

    function handleMouseDown(e) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        closePopover();
      }
    }

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        closePopover();
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // Focus management in presets view
  useEffect(() => {
    if (!isOpen || view !== "presets") return;
    requestAnimationFrame(() => {
      if (!popoverRef.current) return;
      const selected = popoverRef.current.querySelector('[data-selected="true"]');
      const first = popoverRef.current.querySelector("[data-range-item]");
      (selected || first)?.focus();
    });
  }, [isOpen, view]);

  // Arrow key navigation between preset items
  const handleMenuKeyDown = (e) => {
    if (!popoverRef.current || view !== "presets") return;
    const items = Array.from(popoverRef.current.querySelectorAll("[data-range-item]"));
    if (!items.length) return;

    const currentIndex = items.indexOf(document.activeElement);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = (currentIndex + 1) % items.length;
      items[next]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = (currentIndex - 1 + items.length) % items.length;
      items[prev]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  const handleSelectPreset = (id) => {
    onChange?.({ preset: id, from: null, to: null });
    closePopover();
  };

  // Custom range validation
  let computedFromMs = null;
  let computedToMs = null;
  let validationError = null;

  if (!customRange?.from) {
    validationError = "Select a start date";
  } else if (!customRange?.to) {
    validationError = "Select an end date";
  } else {
    const [sh, sm] = (startTime || "00:00").split(":").map(Number);
    const [eh, em] = (endTime || "23:59").split(":").map(Number);

    if (Number.isNaN(sh) || Number.isNaN(sm) || Number.isNaN(eh) || Number.isNaN(em)) {
      validationError = "Enter valid start and end times";
    } else {
      const fDate = new Date(customRange.from);
      fDate.setHours(sh, sm, 0, 0);
      const tDate = new Date(customRange.to);
      tDate.setHours(eh, em, 0, 0);

      computedFromMs = fDate.getTime();
      computedToMs = tDate.getTime();

      if (computedFromMs >= computedToMs) {
        validationError = "End date/time must be after start date/time";
      } else if (computedToMs - computedFromMs > 90 * 86400 * 1000) {
        validationError = "Range cannot exceed 90 days";
      }
    }
  }

  const isValidCustom = !validationError && computedFromMs != null && computedToMs != null;

  const handleApplyCustom = () => {
    if (!isValidCustom) return;
    onChange?.({
      preset: "custom",
      from: computedFromMs,
      to: computedToMs,
    });
    closePopover();
  };

  // Trigger labels
  const triggerBadge = preset === "custom" ? "custom" : getPresetBadge(preset, now);
  const triggerLabel =
    preset === "custom"
      ? rangeLabel("custom", from, to)
      : PRESET_LOOKUP.get(preset)?.label || "Past 24 Hours";

  // Disabled dates for DayPicker
  const disabledDays = [
    { after: new Date() },
    ...(customRange?.from && !customRange?.to
      ? [
          { after: new Date(customRange.from.getTime() + 89 * 86400000) },
          { before: new Date(customRange.from.getTime() - 89 * 86400000) },
        ]
      : []),
  ];

  return (
    <div className="relative inline-block text-left">
      <style>{`
        .rdp-root {
          --rdp-accent-color: var(--color-brand-500, #E56A4A);
          --rdp-accent-background-color: var(--color-brand-100, #fadccf);
          --rdp-today-color: var(--color-brand-500, #E56A4A);
          --rdp-range_start-date-background-color: var(--color-brand-500, #E56A4A);
          --rdp-range_end-date-background-color: var(--color-brand-500, #E56A4A);
          --rdp-range_start-color: #ffffff;
          --rdp-range_end-color: #ffffff;
          --rdp-range_middle-background-color: var(--color-brand-100, #fadccf);
          --rdp-range_middle-color: var(--color-text-main, #0a0a0a);
          --rdp-day-height: 32px;
          --rdp-day-width: 32px;
          --rdp-day_button-height: 30px;
          --rdp-day_button-width: 30px;
          --rdp-day_button-border-radius: 6px;
          --rdp-nav_button-height: 1.75rem;
          --rdp-nav_button-width: 1.75rem;
          --rdp-months-gap: 1.25rem;
          font-size: 0.8125rem;
          color: var(--color-text-main);
        }
        .dark .rdp-root {
          --rdp-accent-background-color: rgba(229, 106, 74, 0.25);
          --rdp-range_middle-background-color: rgba(229, 106, 74, 0.25);
          --rdp-range_middle-color: #ededed;
          color: var(--color-text-main);
        }
        .rdp-day_button:hover:not([disabled]) {
          background-color: var(--color-surface-2);
        }
        .rdp-nav_button {
          color: var(--color-text-muted);
        }
        .rdp-nav_button:hover {
          color: var(--color-text-main);
          background-color: var(--color-surface-2);
          border-radius: 6px;
        }
        .rdp-weekday {
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--color-text-muted);
        }
        .rdp-caption_label {
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--color-text-main);
        }
        .rdp-months {
          flex-wrap: nowrap;
          gap: 1.25rem;
        }
        @media (max-width: 639px) {
          .rdp-months { flex-wrap: wrap; }
        }
        .rdp-month_grid {
          border-collapse: separate;
          border-spacing: 2px;
        }
      `}</style>

      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (isOpen ? closePopover() : openPopover())}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className={cn(
          "inline-flex items-center gap-2 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-[10px]",
          "bg-surface border border-border hover:bg-surface-2 text-text-main shadow-sm",
          "transition-all duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        )}
      >
        <span className="font-mono text-[11px] sm:text-xs px-1.5 py-0.5 rounded bg-surface-2 text-text-muted font-semibold tracking-tight">
          {triggerBadge}
        </span>
        <span className="truncate max-w-[200px] sm:max-w-[260px]">{triggerLabel}</span>
        <span
          className="material-symbols-outlined text-[18px] text-text-muted transition-transform duration-150"
          style={{ transform: isOpen ? "rotate(180deg)" : "none" }}
        >
          expand_more
        </span>
      </button>

      {/* Popover dialog */}
      {isOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Time range selector"
          style={popoverStyle}
          onKeyDown={handleMenuKeyDown}
          className={cn(
            "z-50 bg-surface border border-border rounded-[12px] shadow-elevated p-2 text-text-main",
            view === "presets" ? "w-72 sm:w-80" : "w-auto max-w-[95vw]"
          )}
        >
          {view === "presets" ? (
            <div className="flex flex-col">
              {/* Section 1: Rolling presets (1 column) */}
              <div className="flex flex-col gap-0.5">
                {ROLLING_PRESETS.map((item) => {
                  const isSelected = preset === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-range-item
                      data-selected={isSelected}
                      onClick={() => handleSelectPreset(item.id)}
                      className={cn(
                        "w-full min-h-[36px] px-2.5 py-1.5 rounded-[8px] text-xs sm:text-sm font-medium",
                        "flex items-center justify-between gap-3 text-left transition-colors cursor-pointer",
                        "hover:bg-surface-2 focus:bg-surface-2 focus:outline-none",
                        isSelected
                          ? "text-brand-500 bg-brand-500/10 font-semibold"
                          : "text-text-main"
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono text-[11px] sm:text-xs px-1.5 py-0.5 rounded bg-surface-2 text-text-muted font-semibold min-w-[32px] text-center">
                          {item.short}
                        </span>
                        <span>{item.label}</span>
                      </div>
                      {isSelected && (
                        <span className="material-symbols-outlined text-[16px] text-brand-500 shrink-0">
                          check
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Divider */}
              <div className="my-1.5 border-t border-border" />

              {/* Section 2: Calendar presets (2-column grid) */}
              <div className="grid grid-cols-2 gap-1">
                {CALENDAR_PRESETS.flat().map((id) => {
                  const item = PRESET_LOOKUP.get(id);
                  if (!item) return null;
                  const isSelected = preset === item.id;
                  const badge = getPresetBadge(item.id, now);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-range-item
                      data-selected={isSelected}
                      onClick={() => handleSelectPreset(item.id)}
                      className={cn(
                        "min-h-[36px] px-2 py-1.5 rounded-[8px] text-xs sm:text-sm font-medium",
                        "flex items-center justify-between gap-1.5 text-left transition-colors cursor-pointer",
                        "hover:bg-surface-2 focus:bg-surface-2 focus:outline-none",
                        isSelected
                          ? "text-brand-500 bg-brand-500/10 font-semibold"
                          : "text-text-main"
                      )}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-[11px] sm:text-xs px-1.5 py-0.5 rounded bg-surface-2 text-text-muted font-semibold shrink-0">
                          {badge}
                        </span>
                        <span className="truncate">{item.label}</span>
                      </div>
                      {isSelected && (
                        <span className="material-symbols-outlined text-[16px] text-brand-500 shrink-0">
                          check
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Divider */}
              <div className="my-1.5 border-t border-border" />

              {/* Custom range button */}
              <button
                type="button"
                data-range-item
                data-selected={preset === "custom"}
                onClick={() => setView("custom")}
                className={cn(
                  "w-full min-h-[36px] px-2.5 py-1.5 rounded-[8px] text-xs sm:text-sm font-medium",
                  "flex items-center justify-between gap-2 text-left transition-colors cursor-pointer",
                  "hover:bg-surface-2 focus:bg-surface-2 focus:outline-none",
                  preset === "custom"
                    ? "text-brand-500 bg-brand-500/10 font-semibold"
                    : "text-text-main"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[18px] text-text-muted">
                    calendar_month
                  </span>
                  <span>Custom range…</span>
                </div>
                {preset === "custom" && (
                  <span className="material-symbols-outlined text-[16px] text-brand-500 shrink-0">
                    check
                  </span>
                )}
              </button>
            </div>
          ) : (
            /* Custom range view */
            <div className="p-1">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
                <button
                  type="button"
                  onClick={() => setView("presets")}
                  className="px-2 py-1 rounded hover:bg-surface-2 text-text-muted hover:text-text-main flex items-center gap-1 text-xs font-medium cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                  <span>Presets</span>
                </button>
                <span className="text-xs font-semibold text-text-main">Custom Range</span>
                <div className="w-12" />
              </div>

              {/* Two-month calendar */}
              <div className="flex justify-center overflow-x-auto p-1">
                <DayPicker
                  mode="range"
                  selected={customRange}
                  onSelect={setCustomRange}
                  numberOfMonths={2}
                  defaultMonth={new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)}
                  endMonth={new Date()}
                  disabled={disabledDays}
                  max={89}
                />
              </div>

              {/* Time inputs */}
              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border mt-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="range-start-time" className="text-[11px] font-medium text-text-muted">
                    Start time
                  </label>
                  <input
                    id="range-start-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="bg-surface-2 border border-border rounded-[8px] px-2.5 py-1.5 text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="range-end-time" className="text-[11px] font-medium text-text-muted">
                    End time
                  </label>
                  <input
                    id="range-end-time"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="bg-surface-2 border border-border rounded-[8px] px-2.5 py-1.5 text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
              </div>

              {/* Inline status / validation message */}
              {validationError ? (
                <div className="text-xs text-red-500 flex items-center gap-1.5 mt-2.5">
                  <span className="material-symbols-outlined text-[15px]">error</span>
                  <span>{validationError}</span>
                </div>
              ) : (
                <div className="text-xs text-text-muted mt-2.5">
                  Range: {Math.max(1, Math.ceil((computedToMs - computedFromMs) / 86400000))} day(s) selected
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border mt-3">
                <button
                  type="button"
                  onClick={() => {
                    setView("presets");
                    closePopover();
                  }}
                  className="px-3 py-1.5 text-xs font-semibold rounded-[8px] border border-border text-text-main hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!isValidCustom}
                  onClick={handleApplyCustom}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-[8px] bg-brand-500 hover:bg-brand-600 text-white transition-colors cursor-pointer disabled:bg-surface-3 disabled:text-text-muted disabled:cursor-not-allowed shadow-sm"
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
