const EMPTY_DATA = { clients: [], summaries: [], truncated: false };

export function createClientActivityState() {
  return {
    ...EMPTY_DATA,
    requestedPeriod: null,
    snapshotPeriod: null,
    loading: false,
    error: null,
    stale: false,
    lastSuccess: null,
  };
}

export function reduceClientActivity(state, action) {
  if (action.type === "start") {
    const currentSnapshot = state.lastSuccess?.period === action.period;
    return {
      ...state,
      ...(currentSnapshot ? state.lastSuccess.data : EMPTY_DATA),
      requestedPeriod: action.period,
      snapshotPeriod: currentSnapshot ? action.period : null,
      loading: true,
      error: null,
      stale: false,
    };
  }

  if (action.type === "success") {
    const data = { ...EMPTY_DATA, ...action.data };
    return {
      ...state,
      ...data,
      requestedPeriod: action.period,
      snapshotPeriod: action.period,
      loading: false,
      error: null,
      stale: false,
      lastSuccess: { period: action.period, data },
    };
  }

  if (action.type === "failure") {
    const snapshot = state.lastSuccess;
    return {
      ...state,
      ...(snapshot?.data || EMPTY_DATA),
      requestedPeriod: action.period,
      snapshotPeriod: snapshot?.period || null,
      loading: false,
      error: "Could not refresh client activity.",
      stale: Boolean(snapshot),
    };
  }

  return state;
}
