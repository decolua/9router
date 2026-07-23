"use client";

import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import Button from "./Button";
import Input from "./Input";
import Select from "./Select";
import Toggle from "./Toggle";
import { MAX_ERROR_COOLDOWN_RULES } from "open-sse/services/errorCooldownPolicy.js";
import { useRuntimeTranslation } from "@/i18n/useRuntimeTranslation";

function defaultDuration() {
  return { mode: "five-hours" };
}

function defaultRule() {
  return {
    name: "",
    statusText: "",
    codeText: "",
    message: "",
    scope: "key",
    duration: defaultDuration(),
  };
}

export function createErrorCooldownPolicyDraft(policy) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    enabled: policy?.enabled === true,
    timezone: policy?.timezone || timezone,
    defaultDuration: policy?.defaultDuration?.mode === "end-of-day" ? { mode: "one-day" } : policy?.defaultDuration || defaultDuration(),
    rules: (policy?.rules || []).map((rule) => ({
      ...rule,
      duration: rule.duration?.mode === "end-of-day" ? { mode: "one-day" } : rule.duration,
      statusText: (rule.statuses || []).join(", "),
      codeText: (rule.codes || []).join(", "),
    })),
  };
}

export function serializeErrorCooldownPolicyDraft(draft) {
  return {
    enabled: draft.enabled,
    timezone: draft.timezone,
    defaultDuration: draft.defaultDuration,
    rules: draft.rules.map(({ statusText, codeText, ...rule }) => ({
      ...rule,
      statuses: statusText.split(",").map((value) => value.trim()).filter(Boolean),
      codes: codeText.split(",").map((value) => value.trim()).filter(Boolean),
    })),
  };
}

function DurationFields({ value, onChange, durationOptions, unitOptions, t }) {
  const max = value.unit === "days" ? 30 : value.unit === "hours" ? 720 : 43200;
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <Select
        label={t("Duration")}
        value={value.mode}
        onChange={(event) => onChange(event.target.value === "custom"
          ? { mode: "custom", value: 1, unit: "hours" }
          : { mode: event.target.value })}
        options={durationOptions}
        className={value.mode === "custom" ? "sm:col-span-1" : "sm:col-span-3"}
      />
      {value.mode === "custom" && (
        <>
          <Input
            label={t("Count")}
            type="number"
            min={1}
            max={max}
            value={value.value}
            onChange={(event) => onChange({ ...value, value: event.target.value })}
          />
          <Select
            label={t("Unit")}
            value={value.unit}
            onChange={(event) => onChange({ ...value, unit: event.target.value })}
            options={unitOptions}
          />
        </>
      )}
    </div>
  );
}

DurationFields.propTypes = {
  value: PropTypes.shape({
    mode: PropTypes.string.isRequired,
    value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    unit: PropTypes.string,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  durationOptions: PropTypes.arrayOf(PropTypes.object).isRequired,
  unitOptions: PropTypes.arrayOf(PropTypes.object).isRequired,
  t: PropTypes.func.isRequired,
};

export default function ErrorCooldownPolicyForm({ connectionId, value, onChange }) {
  const { locale, t } = useRuntimeTranslation();
  const [expanded, setExpanded] = useState(value.enabled);
  useEffect(() => setExpanded(value.enabled), [connectionId, value.enabled]);
  const updateRule = (index, update) => {
    const rules = [...value.rules];
    rules[index] = { ...rules[index], ...update };
    onChange({ ...value, rules });
  };

  const moveRule = (index, direction) => {
    const next = index + direction;
    if (next < 0 || next >= value.rules.length) return;
    const rules = [...value.rules];
    [rules[index], rules[next]] = [rules[next], rules[index]];
    onChange({ ...value, rules });
  };

  const removeRule = (index) => {
    onChange({ ...value, rules: value.rules.filter((_, ruleIndex) => ruleIndex !== index) });
  };

  const timezones = useMemo(() => {
    const values = Intl.supportedValuesOf("timeZone");
    if (!values.includes(value.timezone)) values.unshift(value.timezone);
    return values;
  }, [value.timezone]);
  const durationOptions = useMemo(() => {
    const format = (amount, unit) => new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(amount);
    return [
      { value: "half-hour", label: format(30, "minute") },
      { value: "one-hour", label: format(1, "hour") },
      { value: "five-hours", label: format(5, "hour") },
      { value: "one-day", label: format(1, "day") },
      { value: "custom", label: t("Custom") },
    ];
  }, [locale, t]);
  const unitOptions = useMemo(() => {
    const names = new Intl.DisplayNames(locale, { type: "dateTimeField" });
    return [
      { value: "minutes", label: names.of("minute") },
      { value: "hours", label: names.of("hour") },
      { value: "days", label: names.of("day") },
    ];
  }, [locale]);
  const scopeOptions = useMemo(() => [
    { value: "key", label: t("Entire key") },
    { value: "model", label: t("Current model") },
  ], [locale, t]);

  return (
    <div className="rounded-lg border border-border bg-sidebar/20">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-text-main">
        {t("Error cooldown")}
        <span className="material-symbols-outlined text-base">{expanded ? "expand_less" : "expand_more"}</span>
      </button>
      {expanded && <div className="flex flex-col gap-4 border-t border-border p-4">
        <Toggle
          checked={value.enabled}
          onChange={(enabled) => onChange({ ...value, enabled })}
          label={t("Enable")}
          description={t("All errors")}
        />

        {value.enabled && (
          <>
            <Select
              label={t("Timezone")}
              value={value.timezone}
              onChange={(event) => onChange({ ...value, timezone: event.target.value })}
              options={timezones.map((timezone) => ({ value: timezone, label: timezone }))}
            />

            <div className="rounded-lg bg-sidebar/50 p-3">
              <p className="mb-1 text-sm font-medium text-text-main">{t("Default cooldown")}</p>
              <p className="mb-2 text-xs text-text-muted">{t("All errors")}</p>
              <DurationFields
                value={value.defaultDuration}
                onChange={(defaultDurationValue) => onChange({ ...value, defaultDuration: defaultDurationValue })}
                durationOptions={durationOptions}
                unitOptions={unitOptions}
                t={t}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-text-main">{t("Rules")}</p>
                <p className="text-xs text-text-muted">{t("First match wins. All filled fields must match.")}</p>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={value.rules.length >= MAX_ERROR_COOLDOWN_RULES}
                onClick={() => onChange({ ...value, rules: [...value.rules, defaultRule()] })}
              >
                {t("Add")}
              </Button>
            </div>

            {value.rules.map((rule, index) => (
              <div key={index} className="flex flex-col gap-3 rounded-lg border border-border bg-sidebar/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-text-main">{rule.name || `${t("Rule")} ${index + 1}`}</span>
                  <div className="flex gap-1">
                    <button type="button" aria-label={t("Previous")} disabled={index === 0} onClick={() => moveRule(index, -1)} className="rounded p-1 text-text-muted hover:bg-sidebar disabled:opacity-30">
                      <span className="material-symbols-outlined text-base">arrow_upward</span>
                    </button>
                    <button type="button" aria-label={t("Next")} disabled={index === value.rules.length - 1} onClick={() => moveRule(index, 1)} className="rounded p-1 text-text-muted hover:bg-sidebar disabled:opacity-30">
                      <span className="material-symbols-outlined text-base">arrow_downward</span>
                    </button>
                    <button type="button" aria-label={t("Delete")} onClick={() => removeRule(index)} className="rounded p-1 text-red-500 hover:bg-red-500/10">
                      <span className="material-symbols-outlined text-base">delete</span>
                    </button>
                  </div>
                </div>

                <Input label={t("Name")} value={rule.name} maxLength={80} onChange={(event) => updateRule(index, { name: event.target.value })} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    label={`HTTP ${t("Status")}`}
                    value={rule.statusText}
                    placeholder="401, 403, 429"
                    onChange={(event) => updateRule(index, { statusText: event.target.value })}
                  />
                  <Input
                    label="error.code"
                    value={rule.codeText}
                    placeholder="rate_limit_exceeded"
                    onChange={(event) => updateRule(index, { codeText: event.target.value })}
                  />
                </div>
                <Input
                  label={t("Message contains")}
                  value={rule.message}
                  maxLength={200}
                  onChange={(event) => updateRule(index, { message: event.target.value })}
                  hint={t("Case-insensitive")}
                />
                <Select label={t("Scope")} value={rule.scope} onChange={(event) => updateRule(index, { scope: event.target.value })} options={scopeOptions} />
                <DurationFields value={rule.duration} onChange={(duration) => updateRule(index, { duration })} durationOptions={durationOptions} unitOptions={unitOptions} t={t} />
              </div>
            ))}
          </>
        )}
      </div>}
    </div>
  );
}

ErrorCooldownPolicyForm.propTypes = {
  connectionId: PropTypes.string.isRequired,
  value: PropTypes.shape({
    enabled: PropTypes.bool.isRequired,
    timezone: PropTypes.string.isRequired,
    defaultDuration: PropTypes.object.isRequired,
    rules: PropTypes.arrayOf(PropTypes.object).isRequired,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
};
