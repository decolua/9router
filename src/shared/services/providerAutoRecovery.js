import { getProviderConnectionById, getProviderConnections, getSettings, updateProviderConnection, updateSettings } from "@/lib/localDb";

const DEFAULT_INTERVAL_MINUTES = 15;
const HISTORY_LIMIT = 100;
const g = global.__providerAutoRecovery ??= { timer: null, running: false };

async function recordAutoDisableEvent(connection, type, reason = "") {
  const settings = await getSettings();
  const history = Array.isArray(settings.providerAutoDisableHistory) ? settings.providerAutoDisableHistory : [];
  const event = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    timestamp: new Date().toISOString(),
    provider: connection.provider,
    connectionId: connection.id,
    connectionName: connection.name || connection.email || connection.id,
    reason,
  };
  await updateSettings({ providerAutoDisableHistory: [event, ...history].slice(0, HISTORY_LIMIT) });
}

async function testConnectionThroughApi(connectionId) {
  const port = Number(process.env.PORT) || 20128;
  const response = await fetch(`http://127.0.0.1:${port}/api/providers/${encodeURIComponent(connectionId)}/test`, {
    method: "POST",
    headers: { "x-9r-internal-job": "provider-auto-recovery" },
    signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json().catch(() => ({}));
  return response.ok ? data : { valid: false, error: data.error || `自动恢复检测失败（${response.status}）` };
}

export function parseAutoDisableTriggers(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  return [...new Set(items.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
}

export function matchesAutoDisableTrigger(errorText, triggers) {
  const message = String(errorText || "").toLowerCase();
  return !!message && parseAutoDisableTriggers(triggers).some((trigger) => message.includes(trigger));
}

export async function maybeAutoDisableProviderConnection(connectionId, error = {}) {
  if (!connectionId || connectionId === "noauth") return false;
  const settings = await getSettings();
  if (settings.providerAutoDisableEnabled !== true) return false;

  const message = [error.status, error.errorText].filter(Boolean).join(" ");
  if (!matchesAutoDisableTrigger(message, settings.providerAutoDisableTriggers)) return false;

  const connection = await getProviderConnectionById(connectionId);
  if (!connection || connection.isActive === false) return false;

  await updateProviderConnection(connectionId, {
    isActive: false,
    autoDisabled: true,
    autoDisabledAt: new Date().toISOString(),
    autoDisabledReason: String(error.errorText || error.status || "命中自动禁用规则").slice(0, 300),
    autoRecoveryLastCheckedAt: null,
  });
  await recordAutoDisableEvent(connection, "disabled", String(error.errorText || error.status || "命中自动禁用规则").slice(0, 300));
  console.warn(`[ProviderAutoRecovery] auto-disabled ${connection.provider}/${connectionId}: ${message}`);
  return true;
}

export async function runProviderAutoRecovery() {
  if (g.running) return;
  g.running = true;
  try {
    const settings = await getSettings();
    if (settings.providerAutoRecoveryEnabled !== true) return;
    const connections = await getProviderConnections();
    const targets = connections.filter((connection) => connection.autoDisabled === true);
    if (!targets.length) return;

    for (const connection of targets) {
      let result;
      try {
        result = await testConnectionThroughApi(connection.id);
      } catch (error) {
        result = { valid: false, error: error.message || "自动恢复检测失败" };
      }
      const checkedAt = new Date().toISOString();
      if (result.valid) {
        await updateProviderConnection(connection.id, {
          isActive: true,
          autoDisabled: false,
          autoRecoveredAt: checkedAt,
          autoRecoveryLastCheckedAt: checkedAt,
          autoDisabledReason: null,
        });
        await recordAutoDisableEvent(connection, "recovered", "测试模型请求成功");
        console.log(`[ProviderAutoRecovery] restored ${connection.provider}/${connection.id}`);
      } else {
        await updateProviderConnection(connection.id, { autoRecoveryLastCheckedAt: checkedAt });
      }
    }
  } finally {
    g.running = false;
  }
}

export function configureProviderAutoRecovery(settings = {}) {
  if (g.timer) clearInterval(g.timer);
  g.timer = null;
  if (settings.providerAutoRecoveryEnabled !== true) return;
  const minutes = Math.min(1440, Math.max(1, Number(settings.providerAutoRecoveryIntervalMinutes) || DEFAULT_INTERVAL_MINUTES));
  g.timer = setInterval(() => runProviderAutoRecovery().catch((error) => console.warn("[ProviderAutoRecovery] check failed:", error.message)), minutes * 60 * 1000);
  if (g.timer.unref) g.timer.unref();
}

export async function startProviderAutoRecovery() {
  const settings = await getSettings();
  configureProviderAutoRecovery(settings);
  if (settings.providerAutoRecoveryEnabled === true) {
    setTimeout(() => runProviderAutoRecovery().catch(() => {}), 5000);
  }
}
