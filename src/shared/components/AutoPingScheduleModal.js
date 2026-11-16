"use client";

import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input, Select, Toggle } from "@/shared/components";
import { isValidCronExpression, cronMatches, isValidTimezone } from "@/shared/services/cronMatcher";
import { QUOTA_AUTOPING_CONFIG } from "@/shared/constants/config";

const PRESETS = [
  { label: "Every 5 hours (on the hour)", expression: "0 */5 * * *" },
  { label: "Every 6 hours", expression: "0 */6 * * *" },
  { label: "Daily at 09:00", expression: "0 9 * * *" },
  { label: "Weekdays at 09:00", expression: "0 9 * * 1-5" },
  { label: "4x a day (00/06/12/18)", expression: "0 0,6,12,18 * * *" },
];

const MAX = QUOTA_AUTOPING_CONFIG.cronMaxExpressions;

function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// Next few fire times, so an operator can sanity-check an expression before saving.
function previewFireTimes(expressions, timezone, count = 3) {
  const valid = expressions.filter(isValidCronExpression);
  if (valid.length === 0) return [];

  const hits = [];
  const cursor = new Date();
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  // One week of minutes is enough for any expression this UI can produce.
  for (let step = 0; step < 60 * 24 * 7 && hits.length < count; step += 1) {
    if (valid.some((expression) => cronMatches(expression, cursor, timezone))) {
      hits.push(new Date(cursor));
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return hits;
}

function formatFireTime(date, timezone) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone || undefined,
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/**
 * Cron schedule editor for the quota auto-ping. Schedules fire a tiny message
 * ("Only Hi") on a fixed clock so a new 5h window opens when the operator wants
 * one, instead of only reacting to the reported reset time.
 */
export default function AutoPingScheduleModal({ isOpen, onClose, onSave, provider, connection, value }) {
  // Mounting the form only while open (keyed by connection) seeds it from the
  // saved schedule without an effect that re-syncs state on every render.
  if (!isOpen) return null;
  return (
    <ScheduleForm
      key={connection?.id || "new"}
      onClose={onClose}
      onSave={onSave}
      provider={provider}
      connection={connection}
      value={value}
    />
  );
}

function ScheduleForm({ onClose, onSave, provider, connection, value }) {
  const [enabled, setEnabled] = useState(value?.enabled !== false);
  const [expressions, setExpressions] = useState(() => (value?.expressions?.length ? [...value.expressions] : [""]));
  const [timezone, setTimezone] = useState(() => value?.timezone || localTimezone());
  const [text, setText] = useState(() => value?.text || QUOTA_AUTOPING_CONFIG.cronPingText);
  // claude-cli has no API path at all — the binary holds the session, so there
  // is nothing to replay a token against. The selector below is already
  // claude-only; this keeps the stored value honest rather than defaulting a
  // CLI-only provider's schedule to "api".
  const cliOnly = provider === "claude-cli";
  const [via, setVia] = useState(() => (cliOnly || value?.via === "cli" ? "cli" : "api"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const filled = useMemo(() => expressions.map((e) => e.trim()).filter(Boolean), [expressions]);
  const invalid = useMemo(() => filled.filter((e) => !isValidCronExpression(e)), [filled]);
  const preview = useMemo(
    () => (invalid.length === 0 ? previewFireTimes(filled, timezone) : []),
    [filled, invalid.length, timezone],
  );

  const updateExpression = (index, next) =>
    setExpressions((current) => current.map((item, i) => (i === index ? next : item)));
  const addExpression = () =>
    setExpressions((current) => (current.length >= MAX ? current : [...current, ""]));
  const removeExpression = (index) =>
    setExpressions((current) => (current.length === 1 ? [""] : current.filter((_, i) => i !== index)));
  const applyPreset = (expression) =>
    setExpressions((current) => (current.some((item) => item.trim() === expression)
      ? current
      : [...current.filter((item) => item.trim()), expression].slice(0, MAX)));

  const handleSave = async () => {
    if (enabled && filled.length === 0) {
      setError("Add at least one schedule, or turn the schedule off.");
      return;
    }
    if (invalid.length > 0) {
      setError(`Not a valid cron expression: ${invalid.join(", ")}`);
      return;
    }
    // Without this the schedule would quietly run on the server's clock instead.
    if (!isValidTimezone(timezone)) {
      setError(`Not a known IANA timezone: ${timezone}`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        enabled,
        expressions: filled,
        timezone,
        text: text.trim() || QUOTA_AUTOPING_CONFIG.cronPingText,
        via,
      });
      onClose?.();
    } catch (e) {
      setError(e.message || "Failed to save schedule");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(null);
      onClose?.();
    } catch (e) {
      setError(e.message || "Failed to clear schedule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Auto-ping schedule — ${connection?.name || connection?.id || ""}`}>
      <div className="space-y-4">
        <p className="text-sm text-text-muted">
          Sends a tiny message on a schedule so a fresh 5-hour window starts when you want it to.
          Each fire costs a negligible amount of quota, and an exhausted window is skipped.
        </p>

        <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
          <span className="text-sm font-medium text-text-main">Schedule enabled</span>
          <Toggle size="sm" checked={enabled} onChange={() => setEnabled(!enabled)} />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-text-main">
            Cron expressions <span className="text-text-muted">(minute hour day month weekday)</span>
          </label>
          {expressions.map((expression, index) => {
            const trimmed = expression.trim();
            const bad = trimmed && !isValidCronExpression(trimmed);
            return (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={expression}
                  onChange={(e) => updateExpression(index, e.target.value)}
                  placeholder="0 */5 * * *"
                  inputClassName={bad ? "ring-1 ring-red-500" : ""}
                />
                <button
                  type="button"
                  onClick={() => removeExpression(index)}
                  className="rounded px-2 py-1 text-text-muted hover:bg-red-500/10 hover:text-red-500"
                  aria-label="Remove schedule"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            );
          })}
          {expressions.length < MAX && (
            <Button size="sm" variant="secondary" icon="add" onClick={addExpression}>
              Add time
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <span className="block text-sm font-medium text-text-main">Presets</span>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.expression}
                type="button"
                onClick={() => applyPreset(preset.expression)}
                className="rounded-full border border-border px-3 py-1 text-xs text-text-muted hover:border-primary hover:text-primary"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-text-main">Timezone</label>
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Seoul" />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-text-main">Message</label>
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={QUOTA_AUTOPING_CONFIG.cronPingText} />
          </div>
        </div>

        {provider === "claude" && (
          <div className="space-y-1">
            <label className="block text-sm font-medium text-text-main">Send via</label>
            <Select
              value={via}
              onChange={(e) => setVia(e.target.value)}
              options={[
                { value: "api", label: "API (uses this connection's OAuth token)" },
                { value: "cli", label: "Claude Code CLI (`claude -p`) — lower ban risk" },
              ]}
            />
            <p className="text-xs text-text-muted">
              CLI mode spawns the locally installed `claude` binary instead of replaying the OAuth
              token from this server. It requires Claude Code installed on this host, and it pings the
              account that `claude` is signed into — which is not necessarily this connection.
            </p>
          </div>
        )}

        {cliOnly && (
          <p className="text-xs text-text-muted">
            Sent by running <code>claude -p</code> as this account — its config directory or setup
            token, not the host&apos;s ambient login. Claude Code must be installed on the machine
            running 9Router.
          </p>
        )}

        {preview.length > 0 && (
          <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-muted">
            <span className="font-medium text-text-main">Next fires:</span>{" "}
            {preview.map((date) => formatFireTime(date, timezone)).join(" · ")}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3">
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={handleClear} disabled={saving}>
            Remove
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={saving} fullWidth>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving} fullWidth>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

ScheduleForm.propTypes = {
  onClose: PropTypes.func,
  onSave: PropTypes.func.isRequired,
  provider: PropTypes.string,
  connection: PropTypes.shape({ id: PropTypes.string, name: PropTypes.string }),
  value: PropTypes.shape({
    enabled: PropTypes.bool,
    expressions: PropTypes.arrayOf(PropTypes.string),
    timezone: PropTypes.string,
    text: PropTypes.string,
    via: PropTypes.string,
  }),
};

AutoPingScheduleModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func,
  onSave: PropTypes.func.isRequired,
  provider: PropTypes.string,
  connection: PropTypes.shape({ id: PropTypes.string, name: PropTypes.string }),
  value: PropTypes.shape({
    enabled: PropTypes.bool,
    expressions: PropTypes.arrayOf(PropTypes.string),
    timezone: PropTypes.string,
    text: PropTypes.string,
    via: PropTypes.string,
  }),
};
