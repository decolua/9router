export async function fetchDetailById(id, { signal } = {}) {
  try {
    const res = await fetch(
      `/api/usage/request-details/${encodeURIComponent(id)}`,
      { signal, credentials: "same-origin", cache: "no-store" }
    );
    if (!res.ok) return undefined;
    const data = await res.json();
    return data.detail ?? undefined;
  } catch {
    return undefined;
  }
}

export function createEnrichmentState() {
  let sequence = 0;
  let abortController = null;

  return {
    start(detail) {
      this.cancel();
      const seq = ++sequence;
      abortController = new AbortController();
      return { detail, seq, signal: abortController.signal };
    },

    cancel() {
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
    },

    isCurrent(seq) {
      return seq === sequence;
    },

    get sequence() {
      return sequence;
    },
  };
}
