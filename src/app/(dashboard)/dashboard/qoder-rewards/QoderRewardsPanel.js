"use client";

/**
 * Qoder 签到与福利中心（移植自 qoder2api-hub 看板的「签到与福利中心」）。
 *
 * 数据全部来自 /api/qoder/*（受 dashboard 鉴权保护）。本组件只做展示与触发，
 * 所有上游调用的凭据都在服务端，浏览器拿不到令牌。
 * [qoder 权益 v0.6.0]
 */

import { useCallback, useEffect, useState } from "react";

import { Badge, Button, Card, CardSkeleton, Modal } from "@/shared/components";

const PROVIDER_OPTIONS = [
  { value: "", label: "全部账号" },
  { value: "qoder", label: "国际版 (qoder)" },
  { value: "qoder-cn", label: "国内版 (qoder-cn)" },
];

const STATUS_META = {
  completed: { label: "可领取", variant: "primary" },
  claimed: { label: "已领取", variant: "success" },
  not_accepted: { label: "不可领取", variant: "default" },
};

async function api(path, options) {
  const res = await fetch(path, options);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

function statusBadge(status) {
  const meta = STATUS_META[status] || STATUS_META.not_accepted;
  return <Badge variant={meta.variant} dot>{meta.label}</Badge>;
}

export default function QoderRewardsPanel() {
  const [provider, setProvider] = useState("");
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState("");
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");
  const [scheduler, setScheduler] = useState(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);

  // 注意：loadTasks 内**不能**有 await 之前的 setState —— 它在 useEffect 里被同步调用，
  // 同步 setState 会触发 react-hooks/set-state-in-effect（级联渲染）。加载态改由
  // 事件处理器（切换区域 / 点刷新）显式开启。
  const loadTasks = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ connectionId: "all" });
      if (provider) qs.set("provider", provider);
      const data = await api(`/api/qoder/tasks?${qs.toString()}`);
      setView(data);
      setError("");
    } catch (err) {
      setError(err.message);
      setView(null);
    } finally {
      setLoading(false);
    }
  }, [provider]);

  const loadScheduler = useCallback(async () => {
    try {
      setScheduler(await api("/api/qoder/scheduler"));
    } catch {
      setScheduler(null);
    }
  }, []);

  // 放在 IIFE 里执行：避免 "setState synchronously within an effect"（与仓库
  // CLIToolsPageClient 同款写法，await 之后的 setState 不算同步调用）。
  useEffect(() => {
    (async () => {
      await loadTasks();
    })();
  }, [loadTasks]);

  useEffect(() => {
    (async () => {
      await loadScheduler();
    })();
  }, [loadScheduler]);

  const runAction = useCallback(
    async (kind) => {
      setBusy(kind);
      setError("");
      try {
        const path = kind === "benefits" ? "/api/qoder/benefits" : "/api/qoder/checkin";
        const data = await api(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connectionId: "all", provider: provider || null, onlyDaily: true }),
        });
        setLogs(data?.logs || []);
        await loadTasks();
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy("");
      }
    },
    [provider, loadTasks],
  );

  const triggerScheduler = useCallback(async () => {
    setBusy("scheduler");
    try {
      const data = await api("/api/qoder/scheduler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trigger" }),
      });
      if (data?.status) setScheduler(data.status);
      setTimeout(() => {
        loadScheduler();
        loadTasks();
      }, 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }, [loadScheduler, loadTasks]);

  const openScan = useCallback(async () => {
    setScanOpen(true);
    setScanLoading(true);
    setScanResult(null);
    try {
      setScanResult(await api("/api/qoder/credentials/scan"));
    } catch (err) {
      setScanResult({ items: [], error: err.message });
    } finally {
      setScanLoading(false);
    }
  }, []);

  const importCredential = useCallback(
    async (body) => {
      setBusy("import");
      try {
        const data = await api("/api/qoder/credentials/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        setLogs((prev) => [
          ...prev,
          ...(data?.imported || []).map((i) => `✓ 已导入 ${i.provider} / ${i.nickname}`),
          ...(data?.errors || []).map((e) => `! ${e}`),
        ]);
        setScanOpen(false);
        await loadTasks();
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy("");
      }
    },
    [loadTasks],
  );

  const summary = view?.summary || {};
  const tasks = view?.tasks || [];
  const accounts = view?.accounts || [];
  const identity = summary?.campaigns?.identity;

  return (
    <div className="space-y-4">
      <Card
        title="Qoder 签到与福利"
        subtitle="每日签到领 Credits · Pro 福利包 · 兑换码"
        icon="redeem"
        action={
          <div className="flex items-center gap-2">
            <select
              value={provider}
              onChange={(e) => { setLoading(true); setProvider(e.target.value); }}
              className="h-9 px-3 rounded-[10px] bg-surface-2 border border-border text-sm text-text-main"
            >
              {PROVIDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <Button
              variant="secondary"
              icon="refresh"
              loading={refreshing}
              onClick={async () => {
                setRefreshing(true);
                try { await loadTasks(); } finally { setRefreshing(false); }
              }}
            >
              刷新
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button icon="check_circle" onClick={() => runAction("checkin")} loading={busy === "checkin"}>
            一键签到
          </Button>
          <Button variant="secondary" icon="card_giftcard" onClick={() => runAction("benefits")} loading={busy === "benefits"}>
            领取 Pro 福利包
          </Button>
          <Button variant="outline" icon="id_card" onClick={openScan}>
            扫描本机凭证
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="info">账号 {accounts.length || summary.accounts_total || 0}</Badge>
          <Badge variant="primary">套餐 {summary.plan || "-"}</Badge>
          {summary.credits?.remain != null && <Badge variant="success">余额 {summary.credits.remain}</Badge>}
          {identity && (
            <Badge variant={identity === "runtime-info" ? "success" : "warning"} dot>
              {identity === "runtime-info" ? "真机身份" : "派生身份（活动可能偏少）"}
            </Badge>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-500">! {error}</p>}
      </Card>

      <Card title="任务与福利" icon="list_alt">
        {loading ? (
          <CardSkeleton />
        ) : tasks.length === 0 ? (
          <p className="text-sm text-text-muted">
            {view?.msg || "未找到可用 Qoder 账号。请先在 Providers 里添加 Qoder 账号（OAuth / PAT / 本机凭证扫描）。"}
          </p>
        ) : (
          <div className="divide-y divide-border-subtle">
            {tasks.map((t) => (
              <div key={t.task_code} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-text-main text-sm">{t.name}</span>
                      {statusBadge(t.status)}
                      {t.reward_credit > 0 && <Badge variant="warning">+{t.reward_credit} Credits</Badge>}
                      {t.reward_text && <Badge variant="info">{t.reward_text}</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-text-muted break-words">{t.description}</p>
                    {t.code && (
                      <p className="mt-1 text-xs text-text-main">
                        兑换码：<code className="px-1.5 py-0.5 rounded bg-surface-2">{t.code}</code>
                      </p>
                    )}
                  </div>
                  {t.jump_url && (
                    <a
                      href={t.jump_url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-xs text-brand-500 hover:underline"
                    >
                      活动页
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {summary?.codes?.length > 0 && (
        <Card title="已领取的兑换码 / 券" icon="confirmation_number">
          <div className="space-y-2">
            {summary.codes.map((c) => (
              <div key={`${c.campaign}-${c.code}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-text-muted break-all">{c.campaign}</span>
                <code className="px-1.5 py-0.5 rounded bg-surface-2 text-text-main">{c.code}</code>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card
        title="签到调度器"
        subtitle={scheduler?.mode || "整点排程 (09:00 / 21:00 每日签到)"}
        icon="schedule"
        action={
          <Button variant="secondary" icon="bolt" onClick={triggerScheduler} loading={busy === "scheduler"}>
            立即执行一次
          </Button>
        }
      >
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant={scheduler?.started ? "success" : "default"} dot>
            {scheduler?.started ? "运行中" : "未启动"}
          </Badge>
          <Badge variant={scheduler?.enabled ? "info" : "warning"}>
            {scheduler?.enabled ? "已启用" : "已停用"}
          </Badge>
          <Badge variant="default">上次 {(scheduler?.last_run_time || "尚未运行")}</Badge>
          <Badge variant="default">下次 {(scheduler?.next_run_time || "待调度")}</Badge>
        </div>
        {scheduler?.logs?.length > 0 && (
          <pre className="mt-3 max-h-48 overflow-auto text-xs text-text-muted bg-bg border border-border-subtle rounded-[10px] p-3 whitespace-pre-wrap">
            {scheduler.logs.join("\n")}
          </pre>
        )}
      </Card>

      {logs.length > 0 && (
        <Card title="最近一次操作日志" icon="terminal">
          <pre className="max-h-72 overflow-auto text-xs text-text-muted bg-bg border border-border-subtle rounded-[10px] p-3 whitespace-pre-wrap">
            {logs.join("\n")}
          </pre>
        </Card>
      )}

      <Modal isOpen={scanOpen} onClose={() => setScanOpen(false)} title="扫描本机已登录凭证" size="lg">
        <div className="space-y-3">
          <p className="text-sm text-text-muted">
            只读探测本机 Qoder 桌面端 / CLI 已登录的凭证（<b>不显示任何令牌</b>）。
            导入会把凭证写入账号池，请在确认区域与账号后手动点击「导入」。
          </p>
          {scanLoading ? (
            <CardSkeleton />
          ) : scanResult?.error ? (
            <p className="text-sm text-red-500">! {scanResult.error}</p>
          ) : (scanResult?.items || []).length === 0 ? (
            <p className="text-sm text-text-muted">未发现本机凭证（未登录或未安装对应客户端）。</p>
          ) : (
            <div className="divide-y divide-border-subtle">
              {scanResult.items.map((it) => (
                <div key={it.path} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={it.realm === "cn" ? "warning" : "info"}>{it.realmName}</Badge>
                      <Badge variant={it.kind === "app" ? "primary" : "default"}>
                        {it.kind === "app" ? "桌面 App" : "CLI"}
                      </Badge>
                      {it.valid ? <Badge variant="success" dot>可导入</Badge> : <Badge variant="default">不可用</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-text-muted truncate">
                      {it.nickname || it.uid || it.file}
                      {it.expiresIn ? ` · 剩余 ${it.expiresIn}` : ""}
                    </p>
                    {it.error && <p className="mt-1 text-xs text-red-500">{it.error}</p>}
                  </div>
                  <Button
                    size="sm"
                    variant={it.valid ? "primary" : "secondary"}
                    disabled={!it.valid || busy === "import"}
                    onClick={() => importCredential({ path: it.path, realm: it.realm })}
                  >
                    导入
                  </Button>
                </div>
              ))}
            </div>
          )}
          {scanResult?.platform && (
            <p className="text-xs text-text-muted">
              平台 {scanResult.platform}
              {scanResult.dpapiAvailable ? "" : " · 非 Windows：桌面 App 凭证无法解密"}
              {" · 原生身份桥 "}
              国际版 {scanResult.nativeBridge?.intl ? "可用" : "不可用"} /
              国内版 {scanResult.nativeBridge?.cn ? "可用" : "不可用"}
            </p>
          )}
          {(scanResult?.items || []).some((i) => i.valid) && (
            <Button
              variant="outline"
              icon="download_for_offline"
              disabled={busy === "import"}
              onClick={() => importCredential({ all: true })}
            >
              导入全部可用凭证
            </Button>
          )}
        </div>
      </Modal>
    </div>
  );
}