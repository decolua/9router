/**
 * The agent loop: one `session/prompt` turn.
 *
 * stream model deltas → run requested tools (permission-gated) → feed results
 * back → repeat until the model stops, the turn is cancelled or the per-turn
 * request budget is exhausted.
 */

const { toolDefinitions, resolveTool } = require("./tools");
const { log } = require("./log");

const MAX_TURNS = 40;
const MAX_TOOL_RESULTS = 4000;

const systemPrompt = (session) => `You are 9Router's coding agent running inside the user's editor.
Workspace root: ${session.cwd}
Absolute paths are required for file tools; always stay inside the workspace.

Rules:
- Prefer read/search tools before editing; make the smallest change that solves the task.
- Use edit_file for surgical changes and write_file only for new or fully rewritten files.
- Run bash only when necessary; never exfiltrate secrets or touch files outside the workspace.
- Reply concisely in the language the user writes in.`;

const toolTitle = (name, args) => {
  if (name === "read_file" || name === "write_file" || name === "edit_file") return `${name.replace("_", " ")} ${args.path || ""}`.trim();
  if (name === "bash") return `Running: ${String(args.command || "").slice(0, 80)}`;
  if (name === "web_fetch") return `Fetching ${args.url || ""}`;
  if (name === "grep") return `Searching ${args.pattern || ""}`;
  if (name === "glob") return `Matching ${args.pattern || ""}`;
  if (name === "list_dir") return `Listing ${args.path || "."}`;
  return name;
};

const parseArgs = (raw) => {
  if (raw == null) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

function assistantMessage({ content, toolCalls }) {
  const msg = { role: "assistant", content: content || "" };
  if (toolCalls.length) {
    msg.tool_calls = toolCalls.map((tc, i) => ({
      id: tc.id || `call_${i}_${Date.now()}`,
      type: "function",
      function: { name: tc.name, arguments: tc.arguments || "{}" },
    }));
    if (!msg.content) msg.content = null;
  }
  return msg;
}

/**
 * @param {object} o
 * @param {object} o.session   persisted session record
 * @param {object} o.ctx       {session, client, clientCaps, gateway, signal}
 * @param {object[]} o.prompt  ACP content blocks from the client
 * @param {Function} o.notify  (update) => Promise  — session/update sender
 * @param {object[]} o.extraTools  MCP-backed tools merged into the registry
 * @returns {Promise<{stopReason: string}>}
 */
async function runTurn({ session, ctx, prompt, notify, extraTools = [] }) {
  const tools = toolDefinitions(extraTools);
  const history = session.messages;

  const userText = prompt
    .map((b) => {
      if (b?.type === "text") return b.text;
      if (b?.type === "resource" && b.resource?.text) return b.resource.text;
      if (b?.type === "image") return `[image ${b.mimeType || "image"}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
  if (userText) {
    history.push({ role: "user", content: userText });
    if (!session.title) session.title = userText.trim().split(/\r?\n/)[0].slice(0, 60);
  }
  // Non-text prompt content (images) rides along as an image_url block.
  const images = prompt.filter((b) => b?.type === "image");
  if (images.length && history.length) {
    const last = history[history.length - 1];
    last.content = [
      { type: "text", text: userText || "See attached image(s)." },
      ...images.map((b) => ({ type: "image_url", image_url: { url: `data:${b.mimeType || "image/png"};base64,${b.data}` } })),
    ];
  }

  const messages = [{ role: "system", content: systemPrompt(session) }, ...history];
  const ctxSize = ctx.contextLength || 200000;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (ctx.signal?.aborted) return { stopReason: "cancelled" };

    const messageId = `msg_agent_${Date.now().toString(36)}_${turn}`;
    let streamed = "";
    let streamedThought = "";
    let res;
    try {
      res = await ctx.gateway.chat({
        model: session.model,
        messages,
        tools,
        signal: ctx.signal,
        tokenSaver: session.tokenSaver !== false,
        onDelta: (text) => {
          streamed += text;
          notify({ sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } });
        },
        onThought: (text) => {
          streamedThought += text;
          notify({ sessionUpdate: "agent_thought_chunk", messageId, content: { type: "text", text } });
        },
      });
    } catch (err) {
      if (err?.cancelled || ctx.signal?.aborted) return { stopReason: "cancelled" };
      throw err;
    }

    if (res.usage) {
      const used = (res.usage.prompt_tokens || 0) + (res.usage.completion_tokens || 0);
      notify({
        sessionUpdate: "usage_update",
        used,
        size: res.usage.prompt_tokens ? res.usage.prompt_tokens : ctxSize,
        ...(session.cost != null ? { cost: { amount: session.cost, currency: "USD" } } : {}),
      }).catch(() => {});
    }

    const toolCalls = res.toolCalls || [];
    const assistant = assistantMessage({ content: res.content || streamed, toolCalls });
    history.push(assistant);

    if (!toolCalls.length) {
      if (res.finishReason === "length") return { stopReason: "max_tokens" };
      return { stopReason: "end_turn" };
    }

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      const toolCallId = tc.id || `call_${turn}_${i}`;
      const args = parseArgs(tc.arguments);
      const toolCtx = { ...ctx, signal: ctx.signal };
      let resolved = null;
      let guardError = null;
      try {
        resolved = resolveTool(tc.name, args, toolCtx, extraTools);
      } catch (err) {
        // Path guard rejections become a normal failed tool call so the model
        // can react instead of killing the turn.
        guardError = err?.name === "PathEscapeError" ? `Blocked: ${err.message}` : err?.message || String(err);
      }
      const kind = resolved?.def?.kind || "other";
      const rawInput = args;

      await notify({
        sessionUpdate: "tool_call",
        toolCallId,
        name: tc.name || null,
        title: toolTitle(tc.name, args),
        kind,
        status: "pending",
        rawInput,
        ...(resolved?.absPath ? { locations: [{ path: resolved.absPath, line: null }] } : {}),
      });

      if (guardError) {
        await notify({
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "failed",
          content: [{ type: "content", content: { type: "text", text: guardError } }],
        });
        history.push({ role: "tool", tool_call_id: toolCallId, content: `ERROR: ${guardError}` });
        continue;
      }

      if (!resolved) {
        await notify({
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "failed",
          content: [{ type: "content", content: { type: "text", text: `Unknown tool: ${tc.name}` } }],
        });
        history.push({ role: "tool", tool_call_id: toolCallId, content: `Unknown tool: ${tc.name}` });
        continue;
      }

      if (resolved.def.needsPermission) {
        let outcome;
        try {
          outcome = await ctx.client.request("session/request_permission", {
            sessionId: session.id,
            toolCall: { toolCallId, title: toolTitle(tc.name, args), kind, status: "pending", rawInput },
            options: [
              { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
              { optionId: "reject-once", name: "Reject", kind: "reject_once" },
            ],
          });
        } catch {
          outcome = { outcome: { outcome: "cancelled" } };
        }
        const o = outcome?.outcome || {};
        if (o.outcome === "cancelled" || ctx.signal?.aborted) return { stopReason: "cancelled" };
        if (o.outcome !== "selected" || !String(o.optionId || "").startsWith("allow")) {
          const msg = "User declined this action.";
          await notify({ sessionUpdate: "tool_call_update", toolCallId, status: "failed", content: [{ type: "content", content: { type: "text", text: msg } }] });
          history.push({ role: "tool", tool_call_id: toolCallId, content: msg });
          continue;
        }
      }

      await notify({ sessionUpdate: "tool_call_update", toolCallId, status: "in_progress" });

      let result;
      try {
        result = await resolved.def.run({ args, ctx: toolCtx, absPath: resolved.absPath, extra: resolved.def });
        result = { text: String(result?.text ?? "").slice(0, MAX_TOOL_RESULTS), diff: result?.diff, locations: result?.locations };
      } catch (err) {
        const msg = `${err?.name === "PathEscapeError" ? "Blocked: " : ""}${err?.message || String(err)}`;
        await notify({
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "failed",
          content: [{ type: "content", content: { type: "text", text: msg } }],
        });
        history.push({ role: "tool", tool_call_id: toolCallId, content: `ERROR: ${msg}` });
        continue;
      }

      const content = [{ type: "content", content: { type: "text", text: result.text } }];
      if (result.diff) {
        content.push({ type: "diff", path: result.diff.path, oldText: result.diff.oldText ?? null, newText: result.diff.newText });
      }
      await notify({
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "completed",
        content,
        rawOutput: { text: result.text.slice(0, 4000) },
        ...(result.locations ? { locations: result.locations } : {}),
      });
      history.push({ role: "tool", tool_call_id: toolCallId, content: result.text || "(no output)" });
      messages.push({ role: "tool", tool_call_id: toolCallId, content: result.text || "(no output)" });
    }

    // Rebuild the request from the mutated history so tool results are sent.
    messages.length = 0;
    messages.push({ role: "system", content: systemPrompt(session) }, ...history);
  }

  log(`session ${session.id}: request budget exhausted after ${MAX_TURNS} model calls`);
  return { stopReason: "max_turn_requests" };
}

module.exports = { runTurn, systemPrompt, MAX_TURNS };
