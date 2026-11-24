import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

export function startConsoleLogTransport({
  onSnapshot,
  onEvent,
  fetchImpl = globalThis.fetch,
  EventSourceImpl = globalThis.EventSource,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  pollIntervalMs = CONSOLE_LOG_CONFIG.pollIntervalMs,
  streamTimeoutMs = CONSOLE_LOG_CONFIG.streamTimeoutMs,
}) {
  let stopped = false;
  let polling = false;
  let source = null;
  let watchdog = null;
  let pollTimer = null;
  let etag = null;

  const clearWatchdog = () => {
    if (!watchdog) return;
    clearTimeoutImpl(watchdog);
    watchdog = null;
  };

  const fetchSnapshot = async () => {
    const headers = etag ? { "If-None-Match": etag } : undefined;
    const response = await fetchImpl("/api/translator/console-logs", {
      cache: "no-store",
      headers,
    });
    if (stopped || response.status === 304) return;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (stopped) return;
    etag = response.headers?.get?.("etag") || null;
    if (data.success && Array.isArray(data.logs)) onSnapshot(data.logs);
  };

  const poll = async () => {
    if (stopped || !polling) return;
    try {
      await fetchSnapshot();
    } catch (error) {
      console.error("Failed to poll console logs:", error);
    }
    if (!stopped && polling) {
      pollTimer = setTimeoutImpl(poll, pollIntervalMs);
    }
  };

  const switchToPolling = () => {
    if (stopped || polling) return Promise.resolve();
    polling = true;
    clearWatchdog();
    source?.close();
    source = null;
    return poll();
  };

  const startStream = () => {
    if (stopped) return;
    if (!EventSourceImpl) {
      switchToPolling();
      return;
    }

    try {
      source = new EventSourceImpl("/api/translator/console-logs/stream");
    } catch {
      void switchToPolling();
      return;
    }
    source.onmessage = (event) => {
      clearWatchdog();
      etag = null;
      try {
        onEvent(JSON.parse(event.data));
      } catch (error) {
        console.error("Failed to parse console log event:", error);
      }
    };
    source.onerror = switchToPolling;
    watchdog = setTimeoutImpl(switchToPolling, streamTimeoutMs);
  };

  const ready = Promise.resolve(fetchSnapshot())
    .catch((error) => console.error("Failed to load console logs:", error))
    .finally(startStream);

  return {
    ready,
    invalidate() {
      etag = null;
    },
    stop() {
      stopped = true;
      polling = false;
      clearWatchdog();
      if (pollTimer) clearTimeoutImpl(pollTimer);
      source?.close();
    },
  };
}
