/**
 * Qoder SSE is OpenAI-shaped inside `{statusCodeValue, body}` envelopes, but
 * usage arrives on a later `choices: []` frame — after finish_reason, which
 * itself often lives on `delta.finish_reason` rather than the choice.
 *
 * Downstream (Claude translator, OpenAI clients, Claude Code) look for usage
 * on the finish chunk or drop `choices: []` entirely. 9router's own dashboard
 * still sees tokens because extractUsage runs on every forwarded frame.
 *
 * Coalesce: hold empty finish + usage-only frames, then emit one OpenAI
 * include_usage-style chunk: `{choices:[{delta:{}, finish_reason}], usage}`.
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize Qoder/OpenAI usage into the shape stream.js + Claude translation
 * already understand (prompt_tokens + prompt_tokens_details.cached_tokens).
 */
export function canonicalizeQoderUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;

  const prompt = num(usage.prompt_tokens ?? usage.input_tokens);
  const completion = num(usage.completion_tokens ?? usage.output_tokens);
  if (prompt == null && completion == null) return null;

  const details = (usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object")
    ? { ...usage.prompt_tokens_details }
    : {};
  const cached = num(
    details.cached_tokens ??
    usage.cached_tokens ??
    usage.prompt_cache_hit_tokens ??
    usage.cache_read_input_tokens,
  );
  const cacheCreation = num(
    details.cache_creation_tokens ??
    usage.cache_creation_input_tokens,
  );

  const promptTokens = prompt || 0;
  const completionTokens = completion || 0;
  const out = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: num(usage.total_tokens) ?? (promptTokens + completionTokens),
  };

  if (cached != null) {
    out.cached_tokens = cached;
    details.cached_tokens = cached;
  }
  if (cacheCreation != null) {
    details.cache_creation_tokens = cacheCreation;
  }
  if (Object.keys(details).length) out.prompt_tokens_details = details;

  if (usage.completion_tokens_details && typeof usage.completion_tokens_details === "object") {
    out.completion_tokens_details = usage.completion_tokens_details;
  }
  const reasoning = num(usage.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens);
  if (reasoning != null) out.reasoning_tokens = reasoning;

  return out;
}

function finishReasonOf(parsed) {
  const choice = parsed?.choices?.[0];
  return choice?.finish_reason || choice?.delta?.finish_reason || parsed?.finish_reason || null;
}

function hasValuableDelta(parsed) {
  const delta = parsed?.choices?.[0]?.delta;
  if (!delta || typeof delta !== "object") return false;
  if (typeof delta.content === "string" && delta.content.length > 0) return true;
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) return true;
  if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) return true;
  if (delta.role) return true;
  return false;
}

function parseInner(inner) {
  if (inner == null || inner === "") return { raw: false, parsed: null };
  if (inner === "[DONE]") return { done: true };
  if (typeof inner !== "string") {
    if (typeof inner === "object") return { parsed: inner };
    return { raw: true, text: String(inner) };
  }
  try {
    return { parsed: JSON.parse(inner) };
  } catch {
    return { raw: true, text: inner };
  }
}

/**
 * @param {object} opts
 * @param {string} opts.model
 * @param {TextEncoder} opts.encoder
 * @param {string} opts.sseDone  "data: [DONE]\\n\\n"
 */
export function createQoderSseCoalescer({ model, encoder, sseDone }) {
  let pendingFinish = null;
  let pendingUsage = null;
  let lastMeta = { id: null, created: null, model };
  let doneEmitted = false;
  let finishAlreadyForwarded = false;

  const emitJson = (controller, obj) => {
    const sanitized = JSON.stringify(obj).replace(/\r?\n/g, "");
    controller.enqueue(encoder.encode(`data: ${sanitized}\n\n`));
  };

  const emitRaw = (controller, text) => {
    controller.enqueue(encoder.encode(`data: ${String(text).replace(/\r?\n/g, "")}\n\n`));
  };

  const emitDone = (controller) => {
    if (doneEmitted) return;
    controller.enqueue(encoder.encode(sseDone));
    doneEmitted = true;
  };

  const emitTerminal = (controller) => {
    if (!pendingFinish && !pendingUsage) return;
    emitJson(controller, {
      id: lastMeta.id || `qoder-${Date.now()}`,
      object: "chat.completion.chunk",
      created: lastMeta.created || Math.floor(Date.now() / 1000),
      model: lastMeta.model || model,
      choices: [{ index: 0, delta: {}, finish_reason: pendingFinish || "stop" }],
      ...(pendingUsage ? { usage: pendingUsage } : {}),
    });
    pendingFinish = null;
    pendingUsage = null;
  };

  const flush = (controller) => {
    if (doneEmitted) return;
    if (pendingUsage || (pendingFinish && !finishAlreadyForwarded)) {
      emitTerminal(controller);
    }
    emitDone(controller);
  };

  const handleInner = (inner, controller) => {
    if (doneEmitted) return { terminal: true };

    const parsedInner = parseInner(inner);
    if (parsedInner.done) {
      flush(controller);
      return { terminal: true };
    }
    if (parsedInner.raw) {
      emitRaw(controller, parsedInner.text);
      return {};
    }
    const parsed = parsedInner.parsed;
    if (!parsed || typeof parsed !== "object") return {};

    if (typeof parsed.id === "string" && parsed.id) lastMeta.id = parsed.id;
    if (typeof parsed.created === "number") lastMeta.created = parsed.created;
    if (typeof parsed.model === "string" && parsed.model) lastMeta.model = parsed.model;

    const usage = canonicalizeQoderUsage(parsed.usage);
    if (usage) pendingUsage = usage;

    const finish = finishReasonOf(parsed);
    if (hasValuableDelta(parsed)) {
      // Stream content as-is (preserves upstream JSON for tests/clients).
      emitRaw(controller, typeof inner === "string" ? inner : JSON.stringify(parsed));
      if (finish) {
        finishAlreadyForwarded = true;
        // Keep finish around only if we still need a usage trailer.
        pendingFinish = pendingUsage ? finish : null;
      }
      if (pendingFinish && pendingUsage) {
        emitTerminal(controller);
        emitDone(controller);
        return { terminal: true };
      }
      return {};
    }

    if (finish) pendingFinish = finish;

    // Empty finish and/or usage-only: emit as soon as we have both (Qoder
    // order is finish then usage). Don't wait for the later [DONE]/keepalive.
    if ((pendingFinish || finishAlreadyForwarded) && pendingUsage) {
      if (!pendingFinish) pendingFinish = "stop";
      emitTerminal(controller);
      emitDone(controller);
      return { terminal: true };
    }
    return {};
  };

  return {
    handleInner,
    flush,
    get doneEmitted() {
      return doneEmitted;
    },
  };
}
