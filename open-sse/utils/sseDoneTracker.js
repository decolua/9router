export function createSseDoneTracker() {
  let seenDone = false;

  return {
    shouldForward(line) {
      if (line?.trim() !== "data: [DONE]") return true;
      if (seenDone) return false;
      seenDone = true;
      return true;
    },
    hasSeenDone() {
      return seenDone;
    }
  };
}
