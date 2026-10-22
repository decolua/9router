"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Input, Modal } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import {
  PING_SCHEDULE_DEFAULTS,
  getLocalTimezone,
  getScheduleSlotLabels,
  maxSlotsPerDay,
  parseAnchor,
} from "@/shared/services/quotaPingSchedule";

const MODE_OPTIONS = [
  { value: "off", label: "Off", icon: "block" },
  { value: "reset", label: "On reset", icon: "bolt" },
  { value: "schedule", label: "Schedule", icon: "schedule" },
];

function toFormState(schedule, reactive) {
  return {
    mode: schedule?.enabled === true ? "schedule" : reactive === true ? "reset" : "off",
    anchor: schedule?.anchor || PING_SCHEDULE_DEFAULTS.anchor,
    timezone: getLocalTimezone(),
    windowHours: String(schedule?.windowHours ?? PING_SCHEDULE_DEFAULTS.windowHours),
    slotsPerDay: String(schedule?.slotsPerDay ?? PING_SCHEDULE_DEFAULTS.slotsPerDay),
  };
}

export default function AutoPingScheduleModal({ isOpen, onClose, onSave, connection, reactive = false, schedule = null }) {
  // Mounted only while the modal is open, so the initial state is always fresh.
  const [form, setForm] = useState(() => toFormState(schedule, reactive));

  const windowHours = Number(form.windowHours);
  const slotsPerDay = Number(form.slotsPerDay);
  const anchorValid = Boolean(parseAnchor(form.anchor));
  const windowValid = Number.isFinite(windowHours) && windowHours >= 0.5 && windowHours <= 24;
  const slotsMax = windowValid ? maxSlotsPerDay(windowHours) : 24;
  const slotsValid = Number.isInteger(slotsPerDay) && slotsPerDay >= 1 && slotsPerDay <= slotsMax;
  const canSaveSchedule = anchorValid && windowValid && slotsValid;
  const canSave = form.mode !== "schedule" || canSaveSchedule;

  const previewSlots = canSaveSchedule
    ? getScheduleSlotLabels({ enabled: true, ...form, windowHours, slotsPerDay })
    : [];

  // Last slot's window end — the moment coverage stops until the next anchor.
  const coverageEnd = previewSlots.length && windowValid
    ? (() => {
      const { hour, minute } = parseAnchor(form.anchor);
      const total = Math.round(hour * 60 + minute + slotsPerDay * windowHours * 60) % 1440;
      return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    })()
    : "";

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      reactive: form.mode === "reset",
      schedule: form.mode === "schedule"
        ? {
          enabled: true,
          anchor: form.anchor,
          timezone: form.timezone,
          windowHours,
          slotsPerDay,
        }
        : { enabled: false },
    });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Auto-ping settings"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          Configure automated quota pings{connection?.name ? ` for ${connection.name}` : ""} — pick one mode.
        </p>

        <div className="grid grid-cols-3 gap-1 rounded-[10px] bg-surface-2 p-1">
          {MODE_OPTIONS.map((option) => {
            const isSelected = form.mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => update({ mode: option.value })}
                className={cn(
                  "flex h-9 items-center justify-center gap-1.5 rounded-[8px] px-3 text-sm font-medium transition-all",
                  isSelected
                    ? "bg-surface text-text-main shadow-sm"
                    : "text-text-muted hover:text-text-main"
                )}
              >
                <span className="material-symbols-outlined text-[15px] leading-none">
                  {option.icon}
                </span>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>

        {form.mode === "reset" && (
          <p className="text-xs text-text-muted">
            Pings right after the 5h quota window resets, so a new window starts immediately.
          </p>
        )}

        {form.mode === "schedule" && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-text-muted">
              Pings at fixed local times so the 5h windows align with your workday.
            </p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input
                label="Anchor time"
                type="time"
                value={form.anchor}
                onChange={(e) => update({ anchor: e.target.value })}
                error={anchorValid ? "" : "Use HH:MM"}
                inputClassName="ring-1 ring-black/10 dark:ring-white/15"
              />
              <Input
                label="Window (hours)"
                type="number"
                min="0.5"
                max="24"
                step="0.5"
                value={form.windowHours}
                onChange={(e) => update({ windowHours: e.target.value })}
                error={windowValid ? "" : "0.5 – 24"}
                inputClassName="ring-1 ring-black/10 dark:ring-white/15"
              />
              <Input
                label="Pings per day"
                type="number"
                min="1"
                max={String(slotsMax)}
                step="1"
                value={form.slotsPerDay}
                onChange={(e) => update({ slotsPerDay: e.target.value })}
                error={slotsValid ? "" : `1 – ${slotsMax}`}
                hint={slotsValid ? `Max ${slotsMax}` : ""}
                inputClassName="ring-1 ring-black/10 dark:ring-white/15"
              />
            </div>

            {previewSlots.length > 0 && (
              <div className="rounded-[10px] bg-surface-2 px-3 py-2.5">
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  Daily slots ({form.timezone})
                </p>
                <p className="mt-1 text-sm font-medium text-text-main">{previewSlots.join("  →  ")}</p>
                <p className="mt-1 text-xs text-text-muted">
                  Covers {previewSlots[0]} – {coverageEnd}, then pauses until {previewSlots[0]} next day.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

AutoPingScheduleModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  connection: PropTypes.object,
  reactive: PropTypes.bool,
  schedule: PropTypes.object,
};
