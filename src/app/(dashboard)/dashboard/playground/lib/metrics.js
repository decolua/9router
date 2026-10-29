const terminalStates = new Set(["complete", "aborted", "error", "incomplete"]);

function isTerminalEvent(event) {
  return event?.type === "done" || event?.type === "error" || event?.type === "incomplete";
}

function stateForEvent(event) {
  switch (event.type) {
    case "done":
      return "complete";
    case "error":
      return "error";
    case "incomplete":
      return "incomplete";
    default:
      return null;
  }
}

/**
 * Tracks one client-visible Playground stream from request dispatch to terminal.
 * It accepts normalized parser events only, so token usage can never be guessed
 * from bytes, chunks, or text length.
 */
export function createMetricAccumulator(dispatchedAt) {
  let firstTextAt = null;
  let terminalAt = null;
  let terminalState = null;
  let usage = null;

  const finish = (state, at) => {
    if (!terminalStates.has(state) || terminalState) return;
    terminalState = state;
    terminalAt = at;
  };

  return {
    record(event, at) {
      if (!event || terminalState) return;
      if (event.type === "delta" && event.text && firstTextAt === null) {
        firstTextAt = at;
      }
      if (event.type === "usage" && event.usage) {
        usage = event.usage;
      }
      if (isTerminalEvent(event)) {
        finish(stateForEvent(event), at);
      }
    },

    abort(at) {
      finish("aborted", at);
    },

    snapshot() {
      const durationMs = terminalAt === null ? null : terminalAt - dispatchedAt;
      const ttftMs = firstTextAt === null ? null : firstTextAt - dispatchedAt;
      return { durationMs, ttftMs, usage, terminalState };
    },
  };
}
