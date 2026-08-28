"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Card, Button, Input, Toggle } from "@/shared/components";
import {
  CLAUDE_ROLE_KEYS,
  emptyClaudeDefaults,
  buildClaudeEnvOverrides,
} from "@/shared/utils/claudeEnv";

export default function ClaudeCompatPage() {
  // Claude compat layer (Anthropic-protocol clients see claude-* model ids)
  const [claudeCompatEnabled, setClaudeCompatEnabled] = useState(true);
  const [claudeSuffixMode, setClaudeSuffixMode] = useState("auto");
  const [claudeKeywords, setClaudeKeywords] = useState("");

  // Claude default-model mapping (one-click write to ~/.claude/settings.json).
  // The role table auto-generates the env JSON preview; the JSON itself stays
  // editable (dirty flag stops the table from clobbering hand edits).
  const [claudeDefaults, setClaudeDefaults] = useState(emptyClaudeDefaults);
  const [claudeEnvJson, setClaudeEnvJson] = useState("{}");
  const [claudeJsonDirty, setClaudeJsonDirty] = useState(false);
  const [claudeWriteBusy, setClaudeWriteBusy] = useState(false);
  const [claudeWriteMsg, setClaudeWriteMsg] = useState(null);
  // null = Model fields are plain inputs; after "Fetch models" they become
  // selects fed by /v1/models (prefix-free ids).
  const [claudeModelOptions, setClaudeModelOptions] = useState(null);
  const [claudeFetchingModels, setClaudeFetchingModels] = useState(false);

  // Regenerate the env JSON preview from the role table while it stays clean.
  // Render-phase reset per https://react.dev/learn/you-might-not-need-an-effect
  const [prevDefaults, setPrevDefaults] = useState(claudeDefaults);
  if (prevDefaults !== claudeDefaults) {
    setPrevDefaults(claudeDefaults);
    if (!claudeJsonDirty) {
      setClaudeEnvJson(JSON.stringify(buildClaudeEnvOverrides(claudeDefaults), null, 2));
    }
  }

  // Load persisted compat config on mount.
  useEffect(() => {
    const t = setTimeout(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        const cc = data.claudeCompat || {};
        setClaudeCompatEnabled(cc.enabled !== false);
        setClaudeSuffixMode(["off", "auto", "keywords"].includes(cc.suffixMode) ? cc.suffixMode : "auto");
        setClaudeKeywords(Array.isArray(cc.keywords) ? cc.keywords.join(", ") : "");
        if (data.claudeDefaultModels && typeof data.claudeDefaultModels === "object") {
          setClaudeDefaults({ ...emptyClaudeDefaults(), ...data.claudeDefaultModels });
        }
      })
      .catch(() => {});
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const patchClaudeCompat = async (partial) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claudeCompat: partial }),
      });
      return res.ok;
    } catch (error) {
      console.log("Error updating claudeCompat:", error);
      return false;
    }
  };

  const handleClaudeCompatToggle = async (value) => {
    setClaudeCompatEnabled(value);
    await patchClaudeCompat({ enabled: value });
  };

  const handleClaudeSuffixMode = async (mode) => {
    setClaudeSuffixMode(mode);
    await patchClaudeCompat({ suffixMode: mode });
  };

  // ponytail: keywords saved as one comma-separated string — good enough for
  // a handful of substrings; no drag-and-drop list editor needed.
  const handleClaudeKeywordsSave = async () => {
    const keywords = claudeKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const ok = await patchClaudeCompat({ keywords, suffixMode: "keywords" });
    if (ok) setClaudeSuffixMode("keywords");
  };

  const updateClaudeRole = (role, field, value) => {
    setClaudeDefaults((prev) => {
      const next = { ...prev, [role]: { ...prev[role], [field]: value } };
      // Editing the model defaults the display name to the same value;
      // editing the name alone never touches the model.
      if (field === "model") next[role].name = value;
      return next;
    });
  };

  // Fetch the gateway's own model list (/v1/models). The browser request
  // carries no anthropic-version header so ids arrive WITHOUT the claude-
  // prefix; strip prefix + [1M] suffix defensively anyway so the selects
  // never offer a prefixed id.
  const handleFetchClaudeModels = async () => {
    setClaudeFetchingModels(true);
    setClaudeWriteMsg(null);
    try {
      const res = await fetch("/v1/models", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = Array.isArray(data?.data) ? data.data : [];
      const ids = [
        ...new Set(
          items
            .map((m) =>
              String(m?.id || "")
                .replace(/^claude-/, "")
                .replace(/\[1m?\]$/i, ""),
            )
            .filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b));
      setClaudeModelOptions(ids);
    } catch (error) {
      setClaudeWriteMsg({ ok: false, text: `Fetch models failed: ${error.message}` });
    } finally {
      setClaudeFetchingModels(false);
    }
  };

  // Write the (possibly hand-edited) env JSON. Server applies it as a strict
  // key-overwrite on the env object of ~/.claude/settings.json.
  const handleWriteClaudeSettings = async () => {
    let env;
    try {
      env = JSON.parse(claudeEnvJson);
    } catch {
      setClaudeWriteMsg({ ok: false, text: "env JSON is not valid JSON" });
      return;
    }
    if (!env || typeof env !== "object" || Array.isArray(env)) {
      setClaudeWriteMsg({ ok: false, text: "env JSON must be an object of key → value" });
      return;
    }
    setClaudeWriteBusy(true);
    setClaudeWriteMsg(null);
    try {
      const res = await fetch("/api/claude-compat/write-claude-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env, defaultModels: claudeDefaults }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setClaudeWriteMsg({
          ok: true,
          text: `Written ${Object.keys(data.written || {}).length} env keys to ${data.file}`
            + (data.verifyOnly ? " (verify mode — .bak copy, real file untouched)" : ""),
        });
      } else {
        setClaudeWriteMsg({ ok: false, text: data.error || `HTTP ${res.status}` });
      }
    } catch (error) {
      setClaudeWriteMsg({ ok: false, text: error.message });
    } finally {
      setClaudeWriteBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-0">
      {/* Claude Compat (Anthropic-protocol clients) */}
      <Card id="claude-compat">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">smart_toy</span>
            Claude Compat
          </h2>
          <Toggle
            checked={claudeCompatEnabled}
            onChange={handleClaudeCompatToggle}
          />
        </div>
        <p className="text-sm text-text-muted mb-4">
          Lets Anthropic-protocol clients (Claude Code, Claude Desktop) discover and select
          non-Claude models: /v1/models ids get a <code>claude-</code> prefix when the client
          sends an <code>anthropic-version</code> header. OpenAI clients are unaffected.
        </p>

        <div className="flex items-center justify-between py-3 border-t border-border">
          <div>
            <p className="font-medium text-sm">[1m] context suffix</p>
            <p className="text-sm text-text-muted">
              Appended to model ids so Claude Code sends the 1M-context beta header
            </p>
          </div>
          <select
            value={claudeSuffixMode}
            onChange={(e) => handleClaudeSuffixMode(e.target.value)}
            disabled={!claudeCompatEnabled}
            className="text-sm border border-border rounded-md px-2 py-1.5 bg-background"
          >
            <option value="off">Off — never add</option>
            <option value="auto">Auto — context ≥ 1M</option>
            <option value="keywords">Keywords match</option>
          </select>
        </div>

        {claudeCompatEnabled && claudeSuffixMode === "keywords" && (
          <div className="mt-3 pt-3 border-t border-border">
            <label className="font-medium text-sm block mb-1.5">Keywords (comma-separated)</label>
            <div className="flex gap-2">
              <Input
                value={claudeKeywords}
                onChange={(e) => setClaudeKeywords(e.target.value)}
                placeholder="deepseek, glm"
              />
              <Button onClick={handleClaudeKeywordsSave}>Save</Button>
            </div>
            <p className="text-xs text-text-muted mt-1.5">
              [1m] is appended when the model id contains any keyword
            </p>
          </div>
        )}

        {claudeCompatEnabled && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center justify-between mb-1">
              <p className="font-medium text-sm">Default models</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" icon="cloud_download" onClick={handleFetchClaudeModels} disabled={claudeFetchingModels}>
                  {claudeFetchingModels ? "Fetching…" : "Fetch models"}
                </Button>
                <Button variant="primary" size="sm" icon="save" onClick={handleWriteClaudeSettings} disabled={claudeWriteBusy}>
                  {claudeWriteBusy ? "Writing…" : "Write settings"}
                </Button>
              </div>
            </div>
            <p className="text-xs text-text-muted mb-3">
              The role table auto-generates the env JSON (ANTHROPIC_DEFAULT_SONNET/OPUS/FABLE/HAIKU_MODEL,
              {" "}_NAME and CLAUDE_CODE_SUBAGENT_MODEL). The JSON below stays editable — add keys freely.
              Writing only overwrites same-key values inside <code>env</code>; nothing else in
              settings.json is touched.
            </p>

            <div className="grid grid-cols-[80px_1fr_1fr_44px] gap-2 text-xs text-text-muted pb-1">
              <span>Role</span>
              <span>Display name</span>
              <span>Model</span>
              <span className="text-right">1M</span>
            </div>
            {CLAUDE_ROLE_KEYS.map((role) => (
              <div key={role} className="grid grid-cols-[80px_1fr_1fr_44px] gap-2 items-center py-1">
                <span className="text-sm capitalize">{role}</span>
                <Input
                  value={claudeDefaults[role].name}
                  onChange={(e) => updateClaudeRole(role, "name", e.target.value)}
                  placeholder="e.g. glm/glm-5.3"
                />
                <ClaudeModelField
                  value={claudeDefaults[role].model}
                  onChange={(v) => updateClaudeRole(role, "model", v)}
                  options={claudeModelOptions}
                />
                <input
                  type="checkbox"
                  checked={claudeDefaults[role].oneM}
                  onChange={(e) => updateClaudeRole(role, "oneM", e.target.checked)}
                  className="justify-self-end w-4 h-4 accent-indigo-600"
                  title="Declare 1M context ([1M] suffix)"
                />
              </div>
            ))}
            <div className="grid grid-cols-[80px_1fr_1fr_44px] gap-2 items-center py-1">
              <span className="text-sm">SubModel</span>
              <span className="text-xs text-text-muted">not shown in /model menu</span>
              <ClaudeModelField
                value={claudeDefaults.subagent.model}
                onChange={(v) => updateClaudeRole("subagent", "model", v)}
                options={claudeModelOptions}
              />
              <input
                type="checkbox"
                checked={claudeDefaults.subagent.oneM}
                onChange={(e) => updateClaudeRole("subagent", "oneM", e.target.checked)}
                className="justify-self-end w-4 h-4 accent-indigo-600"
                title="Declare 1M context ([1M] suffix)"
              />
            </div>

            <div className="flex items-center justify-between mt-3 mb-1.5">
              <label className="font-medium text-sm">env JSON (editable)</label>
              {claudeJsonDirty && (
                <button
                  onClick={() => setClaudeJsonDirty(false)}
                  className="text-xs text-text-muted hover:text-text-main cursor-pointer"
                >
                  Regenerate from table
                </button>
              )}
            </div>
            <textarea
              value={claudeEnvJson}
              onChange={(e) => { setClaudeEnvJson(e.target.value); setClaudeJsonDirty(true); }}
              spellCheck={false}
              rows={Math.min(14, Math.max(4, claudeEnvJson.split("\n").length))}
              className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
            {claudeWriteMsg && (
              <p className={`text-xs mt-1.5 ${claudeWriteMsg.ok ? "text-green-600" : "text-red-500"}`}>
                {claudeWriteMsg.text}
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// Model cell for the claude default-models table: plain input until
// "Fetch models" supplies the /v1/models option list, then a select.
// Options are prefix-free ids; a current value not in the list (typed
// before the fetch) is kept as a leading option so nothing is lost.
function ClaudeModelField({ value, onChange, options }) {
  if (!options) {
    return (
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. glm/glm-5.3" />
    );
  }
  const list = !value || options.includes(value) ? options : [value, ...options];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-sm border border-border rounded-md px-2 py-1.5 bg-background w-full"
    >
      <option value="">— none —</option>
      {list.map((id) => (
        <option key={id} value={id}>{id}</option>
      ))}
    </select>
  );
}

ClaudeModelField.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(PropTypes.string),
};
