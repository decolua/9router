"use client";

/**
 * 每日自动签到面板。
 *
 * ## 交互
 *
 * - 顶部总开关：打开后由后台调度器每天自动跑一次（默认关闭，见 checkinScheduler.js）。
 * - 每个渠道一行：开关决定它是否纳入**自动**签到；右侧「立即签到」只跑这一个渠道，
 *   是**显式操作**，不受总开关与渠道勾选限制。
 * - 「立即签到」按钮在 `accounts === 0` 时禁用 —— 没有账号的渠道点了只会显示
 *   「没有可签到的账号」，属于无效操作。
 *
 * ## 为什么「立即签到」是灰的要点明原因
 *
 * `codebuddy-intl` 这类渠道可能一个账号都没有。如果按钮照常可点，用户会以为
 * 「点了没反应」；禁用 + 行尾标出「未连接账号」才是诚实的呈现。
 *
 * ## 状态刷新的取舍
 *
 * 一轮签到是「渠道数 × 账号数」次串行上游请求（反风控，不能并发），所以可能跑十几秒。
 * 因此点击后按钮进入 loading 并禁用（不给二次点击的机会），完成后用**本轮返回值**
 * 直接渲染结果，而不是立刻重新 GET —— 省一次上游探测，也避免界面闪回旧状态。
 */

import { useCallback, useEffect, useState } from "react";
import { Card, Button, Toggle, Badge, Spinner } from "@/shared/components";
import { getCurrentLocale, onLocaleChange } from "@/i18n/runtime";

/** 单次请求的超时。一轮可能是 10+ 个串行上游请求，给足余量。 */
const RUN_TIMEOUT_MS = 180_000;

function outcomeVariant(claimed, alreadyClaimed, failed) {
  if (failed > 0) return "warning";
  if (claimed > 0) return "success";
  if (alreadyClaimed > 0) return "info";
  return "default";
}

/**
 * 把一个渠道的计数渲染成**英文**句子，而不是直接用服务端生成的中文 `text`。
 *
 * ⚠️ 为什么必须在前端拼：运行时 i18n 是「英文原文 → 译文」查表（见 src/i18n/runtime.js），
 * 服务端返回的中文原样落在英文界面里，**永远不会被翻译**。实测第一版就是这样：
 * 英文 UI 里混着「Last: 已签到 7」和中文备注。
 * 结构化计数是语言中立的，在前端拼成英文才能进 i18n 查表。
 */
function describeCounts(c) {
  const parts = [];
  if (c.claimed > 0) parts.push(`${c.claimed} claimed`);
  if (c.credit > 0) parts.push(`+${c.credit}`);
  if (c.alreadyClaimed > 0) parts.push(`${c.alreadyClaimed} already done`);
  if (c.inactive > 0) parts.push(`${c.inactive} no activity`);
  if (c.failed > 0) parts.push(`${c.failed} failed`);
  return parts.join(", ") || "Nothing to do";
}

/** 整轮汇总（同样是前端拼英文，理由见 describeCounts）。 */
function summarize(channels) {
  const t = { accounts: 0, claimed: 0, alreadyClaimed: 0, inactive: 0, failed: 0, credit: 0 };
  for (const c of channels) {
    t.accounts += c.accounts || 0;
    t.claimed += c.claimed || 0;
    t.alreadyClaimed += c.alreadyClaimed || 0;
    t.inactive += c.inactive || 0;
    t.failed += c.failed || 0;
    t.credit += c.credit || 0;
  }
  if (t.accounts === 0) return "No accounts to check in";
  const parts = [`${channels.length} provider${channels.length === 1 ? "" : "s"}, ${t.accounts} account${t.accounts === 1 ? "" : "s"}`];
  if (t.claimed > 0) parts.push(`${t.claimed} claimed`);
  if (t.credit > 0) parts.push(`+${t.credit}`);
  if (t.alreadyClaimed > 0) parts.push(`${t.alreadyClaimed} already done`);
  if (t.inactive > 0) parts.push(`${t.inactive} no activity`);
  if (t.failed > 0) parts.push(`${t.failed} failed`);
  return parts.join(" · ");
}

export default function CheckinClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [providers, setProviders] = useState({});
  const [supported, setSupported] = useState([]);
  const [totalAccounts, setTotalAccounts] = useState(0);
  const [ranToday, setRanToday] = useState(false);
  const [state, setState] = useState(null);
  const [running, setRunning] = useState(null); // null | "all" | provider id
  const [lastResult, setLastResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [locale, setLocale] = useState("en");

  // 运行时 i18n 是按英文原文查表的，注册一下让语言切换后重渲染
  useEffect(() => {
    setLocale(getCurrentLocale());
    return onLocaleChange(() => setLocale(getCurrentLocale()));
  }, []);

  const applyStatus = useCallback((data) => {
    setEnabled(data.enabled === true);
    setProviders(data.providers && typeof data.providers === "object" ? data.providers : {});
    setSupported(Array.isArray(data.supported) ? data.supported : []);
    setTotalAccounts(typeof data.totalAccounts === "number" ? data.totalAccounts : 0);
    setRanToday(data.ranToday === true);
    setState(data.state || null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/checkin", { headers: { "Cache-Control": "no-store" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      applyStatus(await res.json());
      setError("");
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [applyStatus]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** 只改设置，不触发签到。 */
  const patch = async (body) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/checkin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      applyStatus(data);
      return true;
    } catch (e) {
      setError(String(e.message || e));
      await refresh(); // 失败时回到服务端的真实状态，不留错误的前端乐观值
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** 跑一轮签到。provider 为空 = 全部渠道。 */
  const run = async (provider) => {
    setRunning(provider || "all");
    setError("");
    setLastResult(null);
    try {
      const qs = provider ? `?provider=${encodeURIComponent(provider)}` : "";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(`/api/checkin${qs}`, { method: "POST", signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
      setLastResult(data);
      // 本轮已写状态文件 —— 刷新状态区（不重新探测上游）
      await refresh();
    } catch (e) {
      setError(e.name === "AbortError" ? "Check-in timed out. Check the server logs for the result." : String(e.message || e));
    } finally {
      setRunning(null);
    }
  };

  const onToggleMaster = (value) => {
    setEnabled(value); // 乐观：开关是纯本地状态，失败时 patch() 会拉回真值
    patch({ enabled: value });
  };

  /**
   * 渠道是否纳入自动签到。
   *
   * ⚠️ 关键语义：`providers` **为空对象 = 全部渠道都纳入**（调度器用
   * `optedIn.length > 0` 判「有没有被显式限制过」）。因此空对象时不能把每个开关
   * 都画成「关」—— 那会显示成「一个都不签」，而实际行为是全签，属于欺骗性 UI。
   * 一旦用户动了任何一个开关，就把整份名单**具体化**成显式映射。
   */
  const explicitSelection = Object.keys(providers).length > 0;
  const isIncluded = (id) => (explicitSelection ? providers[id] === true : true);

  const onToggleProvider = (id, value) => {
    // 具体化：以「当前生效的完整名单」为基准改一项，避免把其余渠道意外排除。
    const next = {};
    for (const p of supported) next[p.id] = isIncluded(p.id);
    next[id] = value;
    setProviders(next);
    patch({ providers: next });
  };

  /** 上次逐渠道结果（来自状态文件）。 */
  const lastChannels = state?.channels || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── 错误提示 ── */}
      {error && (
        <div className="p-3 rounded-[10px] bg-red-500/10 border border-red-500/30 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* ── 总开关 ── */}
      <Card
        title="Daily Auto Check-in"
        subtitle="Automatically claim daily credits from providers that support check-in"
        icon="event_available"
        action={
          <Button onClick={() => run(null)} disabled={running !== null || saving} size="sm">
            {running === "all" ? "Running…" : "Check in all now"}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <Toggle
              checked={enabled}
              onChange={onToggleMaster}
              disabled={saving}
              label="Enable automatic check-in"
              description={
                enabled
                  ? "Runs once per day shortly after startup, then re-checks every 30 minutes"
                  : "Off — nothing is claimed automatically (manual buttons below still work)"
              }
            />
            <div className="flex items-center gap-2 shrink-0">
              {enabled ? (
                <Badge variant="success" dot>
                  Enabled
                </Badge>
              ) : (
                <Badge variant="default" dot>
                  Disabled
                </Badge>
              )}
              {ranToday && (
                <Badge variant="info" icon="check_circle">
                  Ran today
                </Badge>
              )}
            </div>
          </div>

          <div className="text-xs text-text-muted">
            {totalAccounts > 0
              ? `${totalAccounts} account${totalAccounts === 1 ? "" : "s"} across ${supported.filter((p) => p.accounts > 0).length} provider(s) can check in.`
              : "No connected accounts for any check-in provider yet."}
          </div>

          {/* ── 上次结果摘要 ── */}
          {state?.channels?.length > 0 && (
            <div className="p-3 rounded-[10px] bg-bg border border-border-subtle">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-text-muted">Last run</span>
                <span className="text-xs text-text-muted">
                  {state.lastDate || "—"}
                  {state.lastMarked === false && " · not recorded, will retry"}
                </span>
              </div>
              {/* 汇总在**前端**按结构化计数拼英文 —— 服务端的 lastSummary 是中文字符串，
                  直接渲染会永远无法被 i18n 查表翻译（见 describeCounts 的注释）。 */}
              <div className="text-sm text-text-main mt-1">{summarize(state.channels)}</div>
              <div className="space-y-0.5 mt-2">
                {state.channels.map((c) => (
                  <div key={c.provider} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-text-muted">{c.label || c.provider}</span>
                    <span className="text-text-muted">{describeCounts(c)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ── 本轮结果（刚点完按钮时） ── */}
      {lastResult && (
        <Card title="Latest result" icon="receipt_long">
          <div className="space-y-2">
            {/* 汇总与明细都在前端按结构化计数拼英文 —— 服务端的 summary/text 是中文，
                直接渲染会永远无法被 i18n 查表翻译（见 describeCounts 的注释）。 */}
            <div className="text-sm text-text-main">{summarize(lastResult.channels || [])}</div>
            <div className="text-xs text-text-muted">
              {lastResult.date} · {lastResult.marked ? "recorded for today" : "not recorded (will retry next start)"}
              {lastResult.provider ? ` · only ${lastResult.provider}` : ""}
            </div>
            <div className="space-y-1 mt-2">
              {(lastResult.channels || []).map((c) => (
                <div key={c.provider} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-text-muted">{c.label}</span>
                  <Badge variant={outcomeVariant(c.claimed, c.alreadyClaimed, c.failed)} size="sm">
                    {describeCounts(c)}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* ── 逐渠道 ── */}
      <Card
        title="Providers"
        subtitle="Toggle a provider to include it in the automatic run, or claim it right now"
        icon="dns"
      >
        <div className="space-y-1">
          {supported.map((p) => {
            const hasAccounts = p.accounts > 0;
            const included = isIncluded(p.id);
            const last = lastChannels.find((c) => c.provider === p.id);
            const busy = running === p.id;
            return (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 py-3 border-b border-border-subtle last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-text-main">{p.label}</span>
                    {hasAccounts ? (
                      <Badge variant="default" size="sm">
                        {p.accounts} account{p.accounts === 1 ? "" : "s"}
                      </Badge>
                    ) : (
                      <Badge variant="warning" size="sm">
                        no accounts connected
                      </Badge>
                    )}
                    {/* 未经真实账号实测的渠道要标出来，不假装已验证 */}
                    {p.verified === false && (
                      <Badge variant="info" size="sm">
                        not live-verified
                      </Badge>
                    )}
                  </div>
                  {last?.text && (
                    <div className="text-xs text-text-muted mt-1 truncate">
                      Last: {describeCounts(last)}
                    </div>
                  )}
                  {p.note && (
                    <div className="text-xs text-text-muted mt-1">{p.note}</div>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <Toggle
                    checked={included}
                    onChange={(v) => onToggleProvider(p.id, v)}
                    disabled={saving || !enabled}
                    size="sm"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!hasAccounts || running !== null || saving}
                    onClick={() => run(p.id)}
                  >
                    {busy ? "Running…" : "Check in now"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {!enabled && (
          <div className="text-xs text-text-muted mt-4">
            Per-provider toggles are disabled while automatic check-in is off. The
            &ldquo;Check in now&rdquo; buttons still work.
          </div>
        )}
        {enabled && !explicitSelection && (
          <div className="text-xs text-text-muted mt-4">
            No provider filter set — every provider with accounts is included. Toggling any
            switch above pins the list explicitly.
          </div>
        )}
      </Card>

      {/* ── 说明 ── */}
      <Card title="How it works" icon="help">
        <ul className="text-xs text-text-muted space-y-1.5 list-disc pl-4">
          <li>
            Off by default: check-in spends upstream quota on your behalf, so you opt in here.
          </li>
          <li>
            Accounts are processed one at a time, never in parallel, to avoid tripping
            provider rate limits.
          </li>
          <li>
            A provider is recorded as done for the day only when at least one account reports
            success or &ldquo;already checked in&rdquo;. If every request fails, the day is not
            recorded and the next start retries.
          </li>
          <li>
            <code className="text-[11px]">codebuddy-cn</code> and <code className="text-[11px]">qoder</code> reset daily on
            UTC+8; <code className="text-[11px]">minimax</code> uses your local timezone.
          </li>
          <li>
            <code className="text-[11px]">cline</code>, <code className="text-[11px]">workbuddy</code> and{" "}
            <code className="text-[11px]">raccoon</code> have no check-in endpoint upstream.
          </li>
        </ul>
      </Card>
    </div>
  );
}
