"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Button, Toggle, Input } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

const DLP_TEMPLATES = [
  { id: "minimal", label: "Minimal", types: ["email", "phone"] },
  { id: "standard", label: "Standard", types: ["email", "phone", "cpf", "cnpj", "creditCard", "ip", "apiKey", "password"] },
  { id: "financial", label: "Financial", types: ["creditCard", "apiKey", "cpf", "cnpj"] },
  { id: "brazilian", label: "Brazilian", types: ["cpf", "cnpj", "cep", "phone"] },
  { id: "usa", label: "USA", types: ["usSsn", "usEin", "usZip", "email", "phone"] },
  { id: "eur", label: "EUR", types: ["eurVat", "iban", "email", "phone", "creditCard"] },
  { id: "full", label: "Full", types: ["email", "phone", "cpf", "cnpj", "cep", "creditCard", "ip", "apiKey", "usSsn", "usEin", "usZip", "iban", "eurVat"] },
];

const DLP_CATEGORIES = [
  { id: "contact", label: "Contact", types: [
    { id: "email", label: "Email", desc: "Email addresses" },
    { id: "phone", label: "Phone", desc: "Phone numbers (BR/International)" },
  ]},
  { id: "br", label: "Brazilian IDs", types: [
    { id: "cpf", label: "CPF", desc: "CPF (valid check digits)" },
    { id: "cnpj", label: "CNPJ", desc: "CNPJ (valid check digits)" },
    { id: "cep", label: "CEP", desc: "CEP postal codes (12345-678)" },
  ]},
  { id: "us", label: "USA IDs", types: [
    { id: "usSsn", label: "SSN / ITIN", desc: "US Social Security / ITIN (valid area/group)" },
    { id: "usEin", label: "EIN", desc: "US Employer ID (12-3456789)" },
    { id: "usZip", label: "ZIP Code", desc: "US postal codes (12345 or 12345-6789)" },
  ]},
  { id: "eur", label: "EUR IDs", types: [
    { id: "iban", label: "IBAN", desc: "European bank accounts (mod-97 valid)" },
    { id: "eurVat", label: "EU VAT", desc: "EU VAT numbers (per-country format, no checksum)" },
  ]},
  { id: "financial", label: "Financial", types: [
    { id: "creditCard", label: "Credit Card", desc: "Credit card numbers (Luhn-valid)" },
  ]},
  { id: "network", label: "Network", types: [
    { id: "ip", label: "IP Address", desc: "IP addresses (IPv4/IPv6)" },
    { id: "apiKey", label: "API Key", desc: "API keys & bearer tokens" },
  ]},
  { id: "credentials", label: "Credentials", types: [
    { id: "password", label: "Password", desc: "Passwords & secrets in config-style assignments (password=…, passwd: …, senha …)" },
  ]},
];

const DEFAULT_SETTINGS = {
  dlpEnabled: false,
  dlpConsent: false,
  dlpMode: "pseudo",
  dlpTypes: ["email", "phone", "cpf", "cnpj", "creditCard", "ip", "apiKey"],
  dlpCustomPatterns: [],
  dlpMaskResponses: true,
};

const patchSetting = async (patch) => {
  try {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch (err) { console.error("DLP: error updating setting:", err); }
};

const newPattern = () => ({ id: null, name: "", type: "regex", pattern: "", flags: "", enabled: true });

export default function PrivacyClient() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mapping, setMapping] = useState([]);
  const [mappingCount, setMappingCount] = useState(0);
  const [editing, setEditing] = useState(null);   // custom pattern being edited
  const [testState, setTestState] = useState({}); // { [patternId]: {sample, result} }

  const enabled = !!settings?.dlpEnabled;
  const consented = !!settings?.dlpConsent;
  const showMapping = enabled && settings?.dlpMode === "pseudo";

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setSettings({ ...DEFAULT_SETTINGS, ...data });
    } catch { /* keep defaults */ }
    setLoading(false);
  }, []);

  const loadMapping = useCallback(async () => {
    try {
      const res = await fetch("/api/dlp/mapping");
      const data = await res.json();
      setMapping(data?.entries || []);
      setMappingCount(data?.count || 0);
    } catch { /* keep current */ }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  useEffect(() => {
    if (showMapping) loadMapping();
  }, [showMapping, loadMapping]);

  const onToggleEnabled = async (v) => {
    setSettings((s) => ({ ...s, dlpEnabled: v }));
    await patchSetting({ dlpEnabled: v });
  };
  const onConsentChange = async (v) => {
    setSettings((s) => ({ ...s, dlpConsent: v, dlpEnabled: v }));
    await patchSetting({ dlpConsent: v, dlpEnabled: v });
  };
  const onSetMode = async (m) => {
    setSettings((s) => ({ ...s, dlpMode: m }));
    await patchSetting({ dlpMode: m });
  };
  const onToggleType = async (id) => {
    const next = settings.dlpTypes.includes(id)
      ? settings.dlpTypes.filter((t) => t !== id)
      : [...settings.dlpTypes, id];
    setSettings((s) => ({ ...s, dlpTypes: next }));
    await patchSetting({ dlpTypes: next });
  };
  const onApplyTemplate = async (tpl) => {
    setSettings((s) => ({ ...s, dlpTypes: tpl.types }));
    await patchSetting({ dlpTypes: tpl.types });
  };
  const onToggleResponses = async (v) => {
    setSettings((s) => ({ ...s, dlpMaskResponses: v }));
    await patchSetting({ dlpMaskResponses: v });
  };
  const onSaveCustom = async () => {
    if (!editing || !editing.name.trim() || !editing.pattern.trim()) return;
    const cp = { ...editing, name: editing.name.trim(), pattern: editing.pattern.trim() };
    if (!cp.id) cp.id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now().toString(36)}`;
    const exists = settings.dlpCustomPatterns.some((e) => e.id === cp.id);
    const next = exists
      ? settings.dlpCustomPatterns.map((e) => (e.id === cp.id ? cp : e))
      : [...settings.dlpCustomPatterns, cp];
    setSettings((s) => ({ ...s, dlpCustomPatterns: next }));
    setEditing(null);
    await patchSetting({ dlpCustomPatterns: next });
  };
  const onToggleCustomEnabled = async (cp, v) => {
    const next = settings.dlpCustomPatterns.map((e) => (e.id === cp.id ? { ...e, enabled: v } : e));
    setSettings((s) => ({ ...s, dlpCustomPatterns: next }));
    await patchSetting({ dlpCustomPatterns: next });
  };
  const onDeleteCustom = async (id) => {
    const next = settings.dlpCustomPatterns.filter((e) => e.id !== id);
    setSettings((s) => ({ ...s, dlpCustomPatterns: next }));
    await patchSetting({ dlpCustomPatterns: next });
  };
  const onRunTest = async (cp, rowId) => {
    const sample = testState[rowId]?.sample || "";
    setTestState((t) => ({ ...t, [rowId]: { sample, result: null } }));
    try {
      const res = await fetch("/api/dlp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: cp.type, pattern: cp.pattern, flags: cp.flags || "", sampleText: sample }),
      });
      const result = await res.json();
      setTestState((t) => ({ ...t, [rowId]: { sample, result } }));
    } catch (err) {
      console.error("DLP: error running test:", err);
    }
  };
  const onClearMapping = async () => {
    try { await fetch("/api/dlp/mapping", { method: "DELETE" }); } catch { /* keep state */ }
    setMapping([]);
    setMappingCount(0);
  };

  if (loading) return <div className="p-6 text-sm text-text-muted">Loading…</div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 1. Enable */}
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">
                shield
              </span>
              Privacy
            </h2>
            <p className="text-sm text-text-muted mt-1">
              Detect and mask sensitive data (PII) in prompts before they reach
              the upstream model.
            </p>
          </div>
          <Toggle
            checked={enabled}
            onChange={onToggleEnabled}
            disabled={!consented}
            label={enabled ? "Enabled" : "Disabled"}
          />
        </div>
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          ⚠️ Experimental feature — this module is provided as-is. Use at your own risk; we are not liable for any data loss or unexpected behavior.
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={consented}
            onChange={(e) => onConsentChange(e.target.checked)}
          />
          <span className="text-text-muted">
            I understand this feature is experimental and I consent to using it at my own risk, including possible data loss.
          </span>
        </label>
      </Card>

      {!enabled && (
        <p className="text-sm text-text-muted -mt-2">
          Enable masking above to configure detection types, action, custom
          patterns and response masking.
        </p>
      )}

      {/* 2. Masking action — two clickable option cards */}
      <Card>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">
              auto_fix_high
            </span>
            Masking action
          </h2>
        </div>
        <p className="text-sm text-text-muted mb-3">
          Choose what happens to detected sensitive values.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            role="radio"
            aria-checked={settings.dlpMode === "pseudo"}
            onClick={() => onSetMode("pseudo")}
            disabled={!enabled}
            className={cn(
              "text-left p-4 rounded-xl border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
              settings.dlpMode === "pseudo"
                ? "border-primary bg-primary/10"
                : "border-border hover:bg-surface-2 disabled:hover:bg-transparent"
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <span className="material-symbols-outlined text-[18px]">manage_search</span>
              Pseudonymization
            </span>
            <span className="block text-xs text-text-muted mt-1">
              Replace values with stable fake ones kept in a local mapping
              table (<code className="font-mono">[PII-…]</code>).
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={settings.dlpMode === "redact"}
            onClick={() => onSetMode("redact")}
            disabled={!enabled}
            className={cn(
              "text-left p-4 rounded-xl border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
              settings.dlpMode === "redact"
                ? "border-primary bg-primary/10"
                : "border-border hover:bg-surface-2 disabled:hover:bg-transparent"
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <span className="material-symbols-outlined text-[18px]">block</span>
              Anonymization
            </span>
            <span className="block text-xs text-text-muted mt-1">
              Permanently redact values with{" "}
              <code className="font-mono">[PII-REDACTED]</code>. No mapping is
              kept.
            </span>
          </button>
        </div>
      </Card>

      {/* 3. Types: template chips + checkbox grid */}
      <Card>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">
              category
            </span>
            Sensitive data types
          </h2>
        </div>
        <p className="text-sm text-text-muted mb-3">
          Select which PII types to detect, or start from a template.
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          {DLP_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => onApplyTemplate(tpl)}
              disabled={!enabled}
              className="px-3 py-1.5 rounded-full border text-xs font-medium transition-colors disabled:opacity-50 border-border text-text-muted hover:border-primary hover:text-primary hover:bg-primary/5"
            >
              {tpl.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {DLP_CATEGORIES.map((cat) => (
            <div key={cat.id} className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-text-muted/70 uppercase tracking-wider">
                {cat.label}
              </p>
              {cat.types.map((t) => (
                <label
                  key={t.id}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border border-surface-2 cursor-pointer hover:bg-surface-2/50",
                    !enabled && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={settings.dlpTypes.includes(t.id)}
                    onChange={() => onToggleType(t.id)}
                    disabled={!enabled}
                  />
                  <span>
                    <span className="block text-sm font-medium">{t.label}</span>
                    <span className="block text-xs text-text-muted">{t.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>
      </Card>

      {/* 4. Custom patterns */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">
                data_object
              </span>
              Custom patterns
            </h2>
            <p className="text-sm text-text-muted mt-1 mb-3">
              Add your own regex or wildcard rules beyond the built-in types.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={!enabled}
            onClick={() => setEditing(newPattern())}
          >
            Add pattern
          </Button>
        </div>
        {settings.dlpCustomPatterns.length === 0 && (
          <p className="text-sm text-text-muted rounded-lg border border-surface-2 p-3">
            No custom patterns yet.
          </p>
        )}
        <div className="flex flex-col gap-3">
          {settings.dlpCustomPatterns.map((cp, i) => {
            const id = cp.id || `${cp.type}-${cp.pattern}-${i}`;
            const t = testState[id] || {};
            const sample = t.sample || "";
            const result = t.result;
            return (
              <div key={id} className="rounded-lg border border-surface-2 p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{cp.name}</p>
                    <p className="text-xs text-text-muted font-mono truncate">
                      {cp.type}: {cp.pattern}
                      {cp.flags ? ` /${cp.flags}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Toggle
                      size="sm"
                      checked={cp.enabled !== false}
                      disabled={!enabled}
                      onChange={() => onToggleCustomEnabled(cp, cp.enabled !== false ? false : true)}
                    />
                    <Button size="sm" variant="ghost" disabled={!enabled} onClick={() => setEditing({ ...cp, id })}>
                      Edit
                    </Button>
                    <Button size="sm" variant="danger" disabled={!enabled} onClick={() => onDeleteCustom(id)}>
                      Delete
                    </Button>
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Input
                      value={sample}
                      disabled={!enabled}
                      onChange={(e) =>
                        setTestState((st) => ({ ...st, [id]: { sample: e.target.value, result } }))
                      }
                      placeholder="Sample text to test this pattern"
                      className="font-mono text-sm"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!enabled || !sample.trim()}
                    onClick={() => onRunTest(cp, id)}
                  >
                    Test
                  </Button>
                </div>
                {result && (
                  <div className="text-xs">
                    {result.valid !== false ? (
(result.matches || []).length > 0 ? (
                          <>
                            <p className="text-success font-semibold">
                              {(result.matches || []).length} match{(result.matches || []).length === 1 ? "" : "es"} — preview:
                            </p>
                            <pre className="mt-1 max-h-32 overflow-auto rounded bg-surface-2 p-2 text-[10px] leading-tight text-text-muted whitespace-pre-wrap font-mono">
                              {(result.preview || "").split("[PII-REDACTED]").map((part, j, arr) => (
                              <span key={j}>
                                {part}
                                {j < arr.length - 1 && (
                                  <span className="text-amber-500 font-semibold">[PII-REDACTED]</span>
                                )}
                              </span>
                            ))}
                          </pre>
                        </>
                      ) : (
                        <p className="text-text-muted">No matches in sample text.</p>
                      )
                    ) : (
                      <p className="text-error font-semibold">Invalid pattern: {result.error}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {editing && (
          <div className="rounded-lg border border-border p-4 flex flex-col gap-3 mt-3">
            <p className="text-sm font-medium">
              {editing.id ? "Edit pattern" : "Add pattern"}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Name"
                value={editing.name}
                disabled={!enabled}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. Project token"
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-text-main">Type</label>
                <select
                  value={editing.type}
                  disabled={!enabled}
                  onChange={(e) => setEditing({ ...editing, type: e.target.value })}
                  className="w-full py-2.5 px-3 text-sm text-text-main bg-surface-2 rounded-[10px] border border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-50"
                >
                  <option value="regex">regex</option>
                  <option value="wildcard">wildcard</option>
                </select>
              </div>
              <Input
                label="Pattern"
                value={editing.pattern}
                disabled={!enabled}
                onChange={(e) => setEditing({ ...editing, pattern: e.target.value })}
                placeholder={editing.type === "wildcard" ? "sk-*t0k*n-*" : "\\bSK-[a-z0-9]{20}\\b"}
                className="sm:col-span-2 font-mono text-sm"
              />
              <Input
                label="Flags"
                value={editing.flags}
                disabled={!enabled}
                onChange={(e) => setEditing({ ...editing, flags: e.target.value })}
                placeholder="i, g, m, gi"
                className="font-mono text-sm"
              />
            </div>
            <div className="flex items-center justify-between gap-2 mt-1">
              <Toggle
                size="sm"
                checked={editing.enabled !== false}
                disabled={!enabled}
                onChange={(v) => setEditing({ ...editing, enabled: v })}
                label={editing.enabled !== false ? "Active" : "Inactive"}
              />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!enabled || !editing.name.trim() || !editing.pattern.trim()}
                  onClick={onSaveCustom}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* 5. Mask responses toggle */}
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">
                sync_alt
              </span>
              Mask provider responses
            </h2>
            <p className="text-sm text-text-muted mt-1">
              Apply the same rules to upstream responses (e.g. tool results)
              before they reach your client.
            </p>
          </div>
          <Toggle
            checked={settings.dlpMaskResponses}
            disabled={!enabled}
            onChange={onToggleResponses}
          />
        </div>
      </Card>

      {/* 6. Mapping table (pseudo mode only) */}
      {showMapping && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">
                  table_rows
                </span>
                Pseudonym mapping
              </h2>
              <p className="text-sm text-text-muted mt-1">
                {mappingCount} entr{mappingCount === 1 ? "y" : "ies"} in the current
                mapping.
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={mappingCount === 0}
              onClick={onClearMapping}
            >
              Clear mapping
            </Button>
          </div>
          {mapping.length === 0 ? (
            <p className="text-sm text-text-muted rounded-lg border border-surface-2 p-3">
              No pseudonyms yet. They are created as requests are routed through
              this gateway.
            </p>
          ) : (
            <div className="max-h-80 overflow-auto rounded-lg border border-surface-2">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-2">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Type</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Real value</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Pseudonym</th>
                  </tr>
                </thead>
                <tbody>
                  {mapping.map((e) => (
                    <tr key={e.type + e.real} className="border-t border-surface-2">
                      <td className="px-3 py-2 text-xs">{e.type}</td>
                      <td className="px-3 py-2 font-mono text-xs">{e.real}</td>
                      <td className="px-3 py-2 font-mono text-xs">{e.fake}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
