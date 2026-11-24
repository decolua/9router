"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Button, Toggle, Input, Select } from "@/shared/components";
import {
  WINDOW_FIVE_HOUR, WINDOW_WEEKLY, WINDOW_LABELS, MAX_TARGETS,
  DEFAULT_TITLE_TEMPLATE, DEFAULT_BODY_TEMPLATE, isWindowEnabled,
} from "@/shared/services/quotaResetCore";

const API = "/api/settings/quota-reset-notify";
const WINDOWS = [WINDOW_FIVE_HOUR, WINDOW_WEEKLY];
const TYPE_OPTIONS = [
  { value: "generic", label: "Bot / 일반 JSON 웹훅" },
  { value: "slack", label: "Slack" },
  { value: "discord", label: "Discord" },
  { value: "telegram", label: "Telegram" },
];
const PLACEHOLDERS = ["provider", "account", "window", "quota", "usedPercent", "nextResetAt", "previousResetAt", "time"];

function newTarget() {
  return { id: crypto.randomUUID(), name: "", type: "generic", enabled: true, url: "", botToken: "", chatId: "", isNew: true };
}

function toDraft(config) {
  return { ...config, targets: config.targets.map((t) => ({ ...t, url: "", botToken: "" })) };
}

function formatAt(iso) {
  return new Date(iso).toLocaleString();
}

export default function QuotaResetNotifyCard() {
  const [draft, setDraft] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [recent, setRecent] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const apply = useCallback((data) => {
    setDraft(toDraft(data.config));
    setAccounts(data.accounts || []);
    setRecent(data.recent || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(API)
      .then((r) => r.json())
      .then((data) => { if (!cancelled && !data.error) apply(data); else if (!cancelled) setNotice({ error: true, text: data.error }); })
      .catch(() => { if (!cancelled) setNotice({ error: true, text: "설정을 불러오지 못했습니다" }); });
    return () => { cancelled = true; };
  }, [apply]);

  if (!draft) {
    return <Card><div className="p-4 text-sm text-text-muted">{notice?.text || "불러오는 중…"}</div></Card>;
  }

  const patch = (changes) => setDraft((d) => ({ ...d, ...changes }));
  const patchTarget = (id, changes) =>
    setDraft((d) => ({ ...d, targets: d.targets.map((t) => (t.id === id ? { ...t, ...changes } : t)) }));
  const removeTarget = (id) => setDraft((d) => ({ ...d, targets: d.targets.filter((t) => t.id !== id) }));
  const setDefault = (w, value) => patch({ defaults: { ...draft.defaults, [w]: value } });
  const setAccountWindow = (id, w, value) =>
    patch({ connections: { ...draft.connections, [id]: { ...draft.connections[id], [w]: value } } });

  async function call(url, options) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    try {
      const body = {
        enabled: draft.enabled,
        defaults: draft.defaults,
        connections: draft.connections,
        titleTemplate: draft.titleTemplate,
        bodyTemplate: draft.bodyTemplate,
        targets: draft.targets.map(({ isNew, urlSet, urlHost, botTokenSet, ...t }) => t),
      };
      apply(await call(API, { method: "PUT", body: JSON.stringify(body) }));
      setNotice({ text: "저장했습니다" });
    } catch (e) {
      setNotice({ error: true, text: e.message });
    }
  }

  async function test(targetId) {
    try {
      const result = await call(API, { method: "POST", body: JSON.stringify({ action: "test", targetId }) });
      const failed = result.failed?.length ? ` · 실패: ${result.failed.map((f) => `${f.name}(${f.error})`).join(", ")}` : "";
      setNotice({ error: result.sent === 0, text: `테스트 전송 ${result.sent}건 성공${failed}. 저장한 설정으로 보냅니다.` });
    } catch (e) {
      setNotice({ error: true, text: e.message });
    }
  }

  const byProvider = accounts.reduce((acc, a) => ({ ...acc, [a.provider]: [...(acc[a.provider] || []), a] }), {});

  return (
    <Card>
      <div className="flex flex-col gap-5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">리셋 알림 웹훅</h3>
            <p className="text-xs text-text-muted">계정의 5시간·주간 한도가 리셋되면 Slack, Discord, Telegram 또는 Bot 웹훅으로 알립니다.</p>
          </div>
          <Toggle checked={draft.enabled} onChange={(v) => patch({ enabled: v })} />
        </div>

        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-medium">알림 받을 창 (기본값)</h4>
          <div className="flex flex-wrap gap-6">
            {WINDOWS.map((w) => (
              <Toggle key={w} size="sm" label={WINDOW_LABELS[w]} checked={draft.defaults[w]} onChange={(v) => setDefault(w, v)} />
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">전송 대상</h4>
            <Button size="sm" variant="outline" icon="add" disabled={draft.targets.length >= MAX_TARGETS}
              onClick={() => patch({ targets: [...draft.targets, newTarget()] })}>대상 추가</Button>
          </div>
          {draft.targets.length === 0 && <p className="text-xs text-text-muted">대상이 없습니다. 추가해야 알림이 나갑니다.</p>}
          {draft.targets.map((t) => (
            <div key={t.id} className="flex flex-col gap-2 rounded-[10px] border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Input label="이름" value={t.name} placeholder="예: Bot" onChange={(e) => patchTarget(t.id, { name: e.target.value })} />
                <Select label="종류" value={t.type} options={TYPE_OPTIONS} disabled={!t.isNew}
                  onChange={(e) => patchTarget(t.id, { type: e.target.value })} />
                <Toggle size="sm" label="사용" checked={t.enabled !== false} onChange={(v) => patchTarget(t.id, { enabled: v })} />
              </div>
              {t.type === "telegram" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input label="봇 토큰" type="password" autoComplete="off" value={t.botToken}
                    placeholder={t.botTokenSet ? "저장됨 — 바꾸려면 새 토큰 입력" : "123456:ABC…"}
                    onChange={(e) => patchTarget(t.id, { botToken: e.target.value })} />
                  <Input label="Chat ID" value={t.chatId || ""} placeholder="-1001234567890 또는 @채널"
                    onChange={(e) => patchTarget(t.id, { chatId: e.target.value })} />
                </div>
              ) : (
                <Input label="웹훅 URL" type="password" autoComplete="off" value={t.url}
                  placeholder={t.urlSet ? `저장됨 (${t.urlHost}) — 바꾸려면 새 URL 입력` : "https://…"}
                  hint={t.type === "generic" ? "Bot: POST /hooks/notify/<토큰> 주소. {title, text, level}만 보냅니다." : undefined}
                  onChange={(e) => patchTarget(t.id, { url: e.target.value })} />
              )}
              <div className="flex justify-end gap-2">
                {!t.isNew && <Button size="xs" variant="secondary" icon="send" disabled={busy} onClick={() => test(t.id)}>테스트</Button>}
                <Button size="xs" variant="ghost" icon="delete" onClick={() => removeTarget(t.id)}>삭제</Button>
              </div>
            </div>
          ))}
          <p className="text-xs text-text-muted">URL·토큰은 저장 후 다시 표시되지 않습니다. 테스트는 저장된 설정으로만 전송됩니다.</p>
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">메시지</h4>
            <Button size="xs" variant="ghost" onClick={() => patch({ titleTemplate: DEFAULT_TITLE_TEMPLATE, bodyTemplate: DEFAULT_BODY_TEMPLATE })}>기본값으로</Button>
          </div>
          <Input label="제목" value={draft.titleTemplate} maxLength={500} onChange={(e) => patch({ titleTemplate: e.target.value })} />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            본문
            <textarea value={draft.bodyTemplate} maxLength={500} rows={3}
              onChange={(e) => patch({ bodyTemplate: e.target.value })}
              className="w-full rounded-[10px] border border-transparent bg-surface-2 px-3 py-2.5 text-[16px] font-normal text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:text-sm" />
          </label>
          <p className="text-xs text-text-muted">
            사용 가능: {PLACEHOLDERS.map((p) => <code key={p} className="mr-1">{`{${p}}`}</code>)}
          </p>
        </section>

        <details className="rounded-[10px] border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">계정별 설정 ({accounts.length})</summary>
          <div className="mt-3 flex flex-col gap-3">
            {Object.entries(byProvider).map(([provider, list]) => (
              <div key={provider}>
                <div className="mb-1 text-xs font-semibold uppercase text-text-muted">{provider}</div>
                {list.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
                    <span className="min-w-0 truncate text-sm">{a.name}</span>
                    <span className="flex gap-4">
                      {WINDOWS.map((w) => (
                        <Toggle key={w} size="sm" label={WINDOW_LABELS[w]} checked={isWindowEnabled(draft, a.id, w)}
                          onChange={(v) => setAccountWindow(a.id, w, v)} />
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {accounts.length === 0 && <p className="text-xs text-text-muted">활성 계정이 없습니다.</p>}
          </div>
        </details>

        {recent.length > 0 && (
          <section className="flex flex-col gap-1">
            <h4 className="text-sm font-medium">최근 알림</h4>
            {recent.slice(0, 5).map((r) => (
              <div key={`${r.at}-${r.account}-${r.window}`} className="text-xs text-text-muted">
                {formatAt(r.at)} · {r.provider} {r.account} · {WINDOW_LABELS[r.window]} · 성공 {r.sent} / 실패 {r.failed}
              </div>
            ))}
          </section>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className={`text-xs ${notice?.error ? "text-red-500" : "text-text-muted"}`} role="status">{notice?.text}</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon="send" disabled={busy || draft.targets.length === 0} onClick={() => test()}>전체 테스트</Button>
            <Button size="sm" icon="save" loading={busy} onClick={save}>저장</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
