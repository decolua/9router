"use client";

import { useEffect, useState } from "react";
import { Card, Button, Input, Toggle, Badge, ConfirmModal } from "@/shared/components";

// Ready-made entries so the common case is one click rather than hunting for
// a URL. Both are MIT-licensed and widely used.
const SUGGESTED = [
  {
    url: "https://github.com/ayghri/i-have-adhd",
    name: "i-have-adhd",
    blurb: "Leads with the next action, numbers multi-step work, suppresses tangents.",
  },
  {
    url: "https://github.com/epoko77-ai/im-not-ai",
    name: "im-not-ai",
    blurb: "Rewrites Korean AI-sounding text into natural prose.",
  },
];

function formatSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function SkillRow({ skill, busy, onToggle, onRefresh, onDelete }) {
  const [open, setOpen] = useState(false);
  // A skill rides on every routed request, so its cost is worth showing.
  const heavy = skill.tokens > 4000;

  return (
    <div className="p-4 rounded-[14px] border border-border-subtle bg-surface">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-text-main">{skill.name}</span>
            {skill.license && <Badge variant="default">{skill.license}</Badge>}
            <Badge variant={heavy ? "warning" : "default"}>
              ~{skill.tokens.toLocaleString()} tok · {formatSize(skill.bytes)}
            </Badge>
          </div>
          {skill.description && (
            <p className="text-xs text-text-muted mt-1 line-clamp-2">{skill.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {skill.sourceUrl && (
              <a
                href={skill.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-text-muted hover:text-primary inline-flex items-center gap-1 break-all"
              >
                {skill.sourceUrl}
                <span className="material-symbols-outlined text-[12px]">open_in_new</span>
              </a>
            )}
            <button
              onClick={() => setOpen(!open)}
              className="text-[11px] text-primary hover:underline cursor-pointer"
            >
              {open ? "Hide" : "Preview"}
            </button>
            <button
              onClick={() => onRefresh(skill)}
              disabled={busy}
              className="text-[11px] text-text-muted hover:text-primary cursor-pointer disabled:opacity-50"
            >
              Re-fetch
            </button>
            <button
              onClick={() => onDelete(skill)}
              disabled={busy}
              className="text-[11px] text-red-500 hover:underline cursor-pointer disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </div>
        <Toggle checked={skill.enabled} onChange={() => onToggle(skill)} disabled={busy} />
      </div>

      {open && (
        <pre className="mt-3 p-3 rounded-lg bg-surface-2 text-[11px] text-text-muted whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
          {skill.preview}
          {skill.bytes > skill.preview.length ? "\n…" : ""}
        </pre>
      )}
    </div>
  );
}

export default function AgentSkillsCard() {
  const [skills, setSkills] = useState([]);
  const [enabledTokens, setEnabledTokens] = useState(0);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choices, setChoices] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const apply = (data) => {
    setSkills(data.skills || []);
    setEnabledTokens(data.enabledTokens || 0);
  };

  useEffect(() => {
    fetch("/api/skills", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { skills: [] }))
      .then(apply)
      .catch(() => {});
  }, []);

  const reload = () =>
    fetch("/api/skills", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { skills: [] }))
      .then(apply)
      .catch(() => {});

  const install = async (targetUrl, path = "") => {
    const value = (targetUrl || "").trim();
    if (!value) return;
    setBusy(true);
    setError("");
    setChoices(null);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value, path }),
      });
      const data = await res.json().catch(() => ({}));
      // The repo publishes several skills — ask which one.
      if (res.status === 300 && data.needsChoice) {
        setChoices({ url: value, options: data.choices || [] });
        return;
      }
      if (!res.ok) {
        setError(data.error || `Install failed (HTTP ${res.status})`);
        return;
      }
      setUrl("");
      await reload();
    } catch (e) {
      setError(e?.message || "Install failed");
    } finally {
      setBusy(false);
    }
  };

  const patch = async (skill, body) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/skills/${skill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Update failed (HTTP ${res.status})`);
        return;
      }
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (skill) => {
    setConfirmDelete(null);
    setBusy(true);
    try {
      await fetch(`/api/skills/${skill.id}`, { method: "DELETE" });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const notInstalled = SUGGESTED.filter(
    (s) => !skills.some((installed) => (installed.sourceUrl || "").startsWith(s.url)),
  );

  return (
    <Card padding="md">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="text-sm font-semibold text-text-main">Agent Skills</h2>
          <p className="text-xs text-text-muted mt-0.5">
            A SKILL.md from GitHub, appended to the system prompt of every routed request.
            Works with any provider — the text is translated into each wire format.
          </p>
        </div>
        {enabledTokens > 0 && (
          <Badge variant={enabledTokens > 4000 ? "warning" : "default"}>
            ~{enabledTokens.toLocaleString()} tok added per request
          </Badge>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo  or a SKILL.md link"
            disabled={busy}
          />
        </div>
        <Button onClick={() => install(url)} disabled={busy || !url.trim()}>
          {busy ? "Working…" : "Add"}
        </Button>
      </div>

      {error && <div className="text-xs text-red-500 mt-2">{error}</div>}

      {choices && (
        <div className="mt-3 p-3 rounded-lg border border-border-subtle bg-surface-2">
          <div className="text-xs text-text-main mb-2">
            That repository publishes several skills — pick one:
          </div>
          <div className="flex flex-wrap gap-2">
            {choices.options.map((opt) => (
              <button
                key={opt.path}
                onClick={() => install(choices.url, opt.path)}
                disabled={busy}
                className="px-2 py-1 rounded-md bg-primary text-white text-[11px] cursor-pointer disabled:opacity-50"
                title={opt.path}
              >
                {opt.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {notInstalled.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] text-text-muted mb-1.5">Suggested</div>
          <div className="flex flex-wrap gap-2">
            {notInstalled.map((s) => (
              <button
                key={s.url}
                onClick={() => install(s.url)}
                disabled={busy}
                className="px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface hover:bg-surface-2 text-[11px] text-text-main cursor-pointer disabled:opacity-50 text-left"
                title={s.blurb}
              >
                <span className="material-symbols-outlined text-[12px] align-middle mr-1">add</span>
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2 mt-4">
        {skills.length === 0 && (
          <div className="text-xs text-text-muted py-6 text-center">
            No skills installed yet.
          </div>
        )}
        {skills.map((skill) => (
          <SkillRow
            key={skill.id}
            skill={skill}
            busy={busy}
            onToggle={(s) => patch(s, { enabled: !s.enabled })}
            onRefresh={(s) => patch(s, { refresh: true })}
            onDelete={(s) => setConfirmDelete(s)}
          />
        ))}
      </div>

      <ConfirmModal
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => remove(confirmDelete)}
        title="Remove skill"
        message={`Remove "${confirmDelete?.name}"? It will stop being added to requests.`}
        confirmText="Remove"
        variant="danger"
      />
    </Card>
  );
}
