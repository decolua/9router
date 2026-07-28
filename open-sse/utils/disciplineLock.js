// Builds the callback the streaming layer fires when a model crosses the
// malformed-output strike threshold. Extracted from the chat handler so the
// wiring is testable on its own: argument order into markAccountUnavailable,
// the status used for the lock, the message shape, and the guarantee that a
// rejected lock never escapes into the response stream.
//
// The strike store is unit-tested separately; this covers the seam between it
// and the account-lock path, which no test previously exercised.

export function buildDisciplineLock({
  markAccountUnavailable,
  connectionId,
  provider,
  model,
  status,
  onError,
}) {
  return function disciplineLock(kind) {
    return markAccountUnavailable(
      connectionId,
      status,
      `Malformed model output: ${kind}`,
      provider,
      model
    ).catch((error) => {
      try {
        onError?.(error);
      } catch {
        /* logging must never break the stream */
      }
    });
  };
}
