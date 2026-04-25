export interface LiveStatsPayload {
  activeRequests?: unknown;
  recentRequests?: unknown;
  errorProvider?: string;
  pending?: unknown;
}

export interface BaseStats {
  totalRequests: number;
  totalCost: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  activeRequests: unknown[];
  recentRequests: unknown[];
  errorProvider: string;
  pending?: unknown;
}

const isSame = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function mergeLiveStats<T extends BaseStats>(prev: T, payload: LiveStatsPayload): T {
  const nextActive = payload.activeRequests ?? prev.activeRequests;
  const nextRecent = payload.recentRequests ?? prev.recentRequests;
  const nextError = payload.errorProvider ?? prev.errorProvider;
  const nextPending = payload.pending ?? prev.pending;

  const unchanged =
    isSame(prev.activeRequests, nextActive) &&
    isSame(prev.recentRequests, nextRecent) &&
    prev.errorProvider === nextError &&
    isSame(prev.pending, nextPending);

  if (unchanged) return prev;

  return {
    ...prev,
    activeRequests: nextActive as T["activeRequests"],
    recentRequests: nextRecent as T["recentRequests"],
    errorProvider: nextError,
    pending: nextPending as T["pending"],
  };
}

export function defaultStats<T extends BaseStats>(): T {
  const base: BaseStats = {
    totalRequests: 0,
    totalCost: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    activeRequests: [],
    recentRequests: [],
    errorProvider: "",
  };
  return base as unknown as T;
}
