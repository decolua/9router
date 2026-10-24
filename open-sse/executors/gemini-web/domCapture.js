// DOM-based reply capture for the Gemini web client.
//
// The current Gemini web client streams chat turns over batchexecute rpcids
// that Google rotates freely (aPya6c at the time of writing), and those bodies
// cannot be re-read via CDP once the stream finishes. The DOM is the stable
// contract: assistant messages render into `model-response` bubbles, so we
// poll those and emit deltas as the text grows — immune to endpoint churn.

const POLL_INTERVAL_MS = 400;
const STABLE_POLLS_DONE = 5;
// Safety valve: finish even if the thinking overlay never clears (UI change).
const STABLE_POLLS_FORCE = 20;
const FIRST_TOKEN_TIMEOUT_MS = 30000;
const REPLY_TIMEOUT_MS = 60000;

const ASSISTANT_SELECTOR = "model-response, message-content";

const READ_REPLY_STATE = `(() => {
  const msgs = [...document.querySelectorAll(${JSON.stringify(ASSISTANT_SELECTOR)})];
  const last = msgs.length ? (msgs[msgs.length - 1].innerText || '').trim() : '';
  return {
    count: msgs.length,
    lastText: last,
    generating: !!document.querySelector('[data-test-id="thinking-overlay-content"], button[aria-label*="Stop" i]'),
  };
})()`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function readReplyState(page) {
  try {
    return (await page.evaluate(READ_REPLY_STATE)) || { count: 0, lastText: "", generating: false };
  } catch {
    // Page navigating mid-poll — treat as "no change yet".
    return { count: 0, lastText: "", generating: false };
  }
}

/**
 * Wait for the assistant reply that follows the just-sent message and return
 * its full text. `onDelta` (when given) receives each incremental chunk as the
 * bubble streams.
 *
 * Interim bubble texts ("Searching the web" …) are replaced wholesale by the
 * real answer while the thinking overlay is up, so deltas are only emitted
 * once the overlay is gone — a client must never receive an interim status as
 * content. Completion: unchanged text for STABLE_POLLS_DONE polls with the
 * overlay gone (STABLE_POLLS_FORCE fires regardless, as a UI-change valve).
 */
export async function waitForGeminiReply({
  page,
  baseCount = 0,
  baseText = "",
  timeoutMs = REPLY_TIMEOUT_MS,
  firstTokenMs = FIRST_TOKEN_TIMEOUT_MS,
  signal,
  onDelta,
}) {
  const started = Date.now();
  let emitted = "";
  let last = null;
  let stable = 0;
  let gotFirst = false;

  while (true) {
    if (signal?.aborted) throw new Error("Request aborted");
    const elapsed = Date.now() - started;
    if (elapsed > timeoutMs) throw new Error("Gemini reply timed out");
    if (!gotFirst && elapsed > firstTokenMs) throw new Error("no first token from Gemini");
    await sleep(POLL_INTERVAL_MS);

    const st = await readReplyState(page);
    const text = st.lastText || "";
    const isNew = st.count > baseCount || (text && text !== baseText);
    if (!isNew || !text) continue;

    gotFirst = true;
    if (text !== last) {
      last = text;
      stable = 0;
    } else {
      stable++;
    }

    if (!st.generating && text !== emitted) {
      const delta = text.startsWith(emitted) ? text.slice(emitted.length) : text;
      if (delta) {
        emitted = text;
        onDelta?.(delta);
      }
    }
    if (stable >= STABLE_POLLS_FORCE) return emitted || text;
    if (!st.generating && stable >= STABLE_POLLS_DONE && text === emitted) return emitted;
  }
}
