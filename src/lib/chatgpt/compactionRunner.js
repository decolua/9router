import { randomUUID } from "node:crypto";
import { compactRequest, compactResponse, compactionTranscript, IncompleteCompactionSummaryError, readCompactionCompletion } from "./compact.js";

const MAX_PART_BYTES = 256 * 1024;
const PARALLEL_PARTS = 2;
const MAX_ROUNDS = 8;
const MAX_PART_SPLITS = 4;
const MIN_PART_BYTES = 8 * 1024;
const HEARTBEAT_MS = 15000;
const MAX_DURATION_MS = 20 * 60 * 1000;

// A UTF-8 byte budget is deliberately conservative across provider tokenizers.
// Reserve space for the summarizer instructions and its generated answer.
export function compactionBudget(contextWindow) {
  const context = Number.isFinite(contextWindow) && contextWindow >= 4096 ? Math.floor(contextWindow) : 32768;
  const maxOutputTokens = Math.min(8192, Math.floor(context / 4));
  return { maxOutputTokens, partBytes: Math.min(MAX_PART_BYTES, context - maxOutputTokens - 2048) };
}

export function splitCompactionTranscript(text, partBytes) {
  const bytes = Buffer.from(text);
  const parts = [];
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + partBytes, bytes.length);
    // Never split a code point, including at an escaped JSON/text boundary.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return parts.length ? parts : [""];
}

async function summarizePart(body, transcript, budget, invoke, signal, part, depth = 0) {
  signal.throwIfAborted();
  try {
    const request = compactRequest(body, { transcript, maxOutputTokens: budget.maxOutputTokens, part });
    return await readCompactionCompletion(await invoke(request, signal));
  } catch (error) {
    // HTTP 200 can still contain an empty or truncated completion. Retry only
    // that chronological fragment at a smaller size; upstream HTTP failures
    // remain failures and do not multiply provider requests.
    if (!(error instanceof IncompleteCompactionSummaryError) || depth >= MAX_PART_SPLITS || Buffer.byteLength(transcript) <= MIN_PART_BYTES) throw error;
    const fragments = splitCompactionTranscript(transcript, Math.ceil(Buffer.byteLength(transcript) / 2));
    const summaries = [];
    for (let index = 0; index < fragments.length; index++) {
      summaries.push((await summarizePart(body, fragments[index], budget, invoke, signal, { index, count: fragments.length }, depth + 1)).text);
    }
    return { data: null, text: JSON.stringify({ chronological_summaries: summaries.map((summary, index) => ({ part: index + 1, summary })) }) };
  }
}

async function summarizeParts(body, transcript, budget, invoke, signal) {
  let source = transcript;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    signal.throwIfAborted();
    const parts = splitCompactionTranscript(source, budget.partBytes);
    const summaries = new Array(parts.length);
    let cursor = 0;
    let failed = false;
    const tasks = Array.from({ length: Math.min(PARALLEL_PARTS, parts.length) }, async () => {
      while (!failed && cursor < parts.length) {
        const index = cursor++;
        try {
          summaries[index] = await summarizePart(body, parts[index], budget, invoke, signal,
            parts.length > 1 ? { index, count: parts.length } : undefined);
        } catch (error) { failed = true; throw error; }
      }
    });
    // The caller cancels siblings on the first failure. No partial summary is
    // returned, so Codex can keep the original history and retry safely.
    await Promise.all(tasks);
    signal.throwIfAborted();
    if (parts.length === 1 && summaries[0].data) return Response.json(summaries[0].data);
    const merged = JSON.stringify({ chronological_summaries: summaries.map((summary, index) => ({ part: index + 1, summary: summary.text })) });
    if (Buffer.byteLength(merged) >= Buffer.byteLength(source)) {
      throw new Error("Partial summaries did not reduce the transcript size.");
    }
    source = merged;
  }
  throw new Error("Compaction exceeded the number of reduction rounds.");
}

// Keep the existing one-call/HTTP-error contract for small histories. Large
// histories use bounded map/reduce, including a single oversized tool result.
export async function runChatGPTCompaction({ body, contextWindow, invoke, signal, ...format }) {
  const budget = compactionBudget(contextWindow);
  const transcript = compactionTranscript(body);
  if (Buffer.byteLength(transcript) <= budget.partBytes) {
    return compactResponse(await invoke(compactRequest(body, { transcript, maxOutputTokens: budget.maxOutputTokens }), signal), format);
  }
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  const deadline = setTimeout(() => controller.abort(new Error("Compaction exceeded its time limit.")), MAX_DURATION_MS);
  deadline.unref?.();
  const perform = async () => {
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(combined.reason);
      combined.addEventListener("abort", onAbort, { once: true });
      if (combined.aborted) onAbort();
    });
    try {
      const response = await Promise.race([summarizeParts(body, transcript, budget, invoke, combined), aborted]);
      return await compactResponse(response, format);
    } catch (error) {
      controller.abort();
      if (error instanceof Response) return error;
      if (error instanceof IncompleteCompactionSummaryError) {
        return Response.json({ error: { message: error.message } }, { status: 502 });
      }
      return Response.json({ error: { message: `${error?.message || "Compaction failed."} History was not replaced.` } }, { status: signal.aborted ? 499 : 502 });
    } finally {
      combined.removeEventListener("abort", onAbort);
      clearTimeout(deadline);
    }
  };
  if (!format.stream) return perform();

  // Send headers and real SSE heartbeat events immediately. Comments alone do
  // not reset Codex's event idle timeout; a long reduction can exceed the local
  // helper/reverse proxy's header timeout without these events.
  const encoder = new TextEncoder();
  let heartbeat, closed = false;
  const stream = new ReadableStream({
    start(out) {
      const send = value => { if (!closed) out.enqueue(encoder.encode(value)); };
      const ping = () => send('event: ping\ndata: {"type":"ping"}\n\n');
      ping();
      heartbeat = setInterval(ping, HEARTBEAT_MS);
      heartbeat.unref?.();
      void (async () => {
        try {
          const response = await perform();
          if (closed) { await response.body?.cancel(); return; }
          if (!response.ok) {
            const text = await response.text();
            let error;
            try { error = JSON.parse(text)?.error; } catch { /* Plain upstream error. */ }
            const message = typeof error?.message === "string" ? error.message : typeof error === "string" ? error : text.slice(0, 1000);
            const event = { type: "response.failed", response: { id: `resp_${randomUUID()}`, status: "failed", output: [], error: {
              code: "server_error", message: `Compaction failed (HTTP ${response.status}): ${message}${/history was not replaced/i.test(message) ? "" : ". History was not replaced."}`,
            } } };
            send(`event: response.failed\ndata: ${JSON.stringify(event)}\n\n`);
          } else {
            for await (const chunk of response.body) { if (!closed) out.enqueue(chunk); }
          }
          if (!closed) { closed = true; out.close(); }
        } catch (error) {
          if (!closed) { closed = true; out.error(error); }
        } finally { clearInterval(heartbeat); }
      })();
    },
    cancel() { closed = true; clearInterval(heartbeat); controller.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
