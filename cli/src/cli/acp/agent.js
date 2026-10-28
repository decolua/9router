/**
 * ACP agent application: every protocol handler the agent supports.
 *
 * Wiring rules:
 *  - initialize advertises exactly what we implement (nothing aspirational);
 *  - session/new publishes the model picker (configOptions) — the editor never
 *    needs models typed in by hand;
 *  - session/prompt runs the loop and always answers with a StopReason, with
 *    cancellations mapped to `cancelled` instead of a JSON-RPC error.
 */

const crypto = require("crypto");
const path = require("path");
const { buildConfigOptions, applyConfigValue, defaultModel } = require("./configOptions");
const { SessionStore, titleFromPrompt } = require("./sessions");
const { runTurn } = require("./loop");
const { resolveCredentials, storeCredentials, clearCredentials } = require("./auth");
const { startMcpServers, stopMcpServers } = require("./mcp");
const { log, error } = require("./log");

const AGENT_NAME = "9router";
const AGENT_TITLE = "9Router";
const AUTH_AGENT_METHOD = "9router-login";
const AUTH_TERMINAL_METHOD = "9router-terminal-login";
const PAGE_SIZE = 50;

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

/**
 * Throw an ACP-aware JSON-RPC error whose message reaches the editor verbatim.
 * A plain `Error` would be flattened to `Internal error` + `data.details`,
 * which is useless in a UI. Codes live in the JSON-RPC server range.
 */
function protocolError(acp, message, code = -32001) {
  return new acp.RequestError(code, String(message));
}

function createAgentApp(acp, { opts = {}, version = "0.0.0", gatewayFactory, store } = {}) {
  const sessions = store || new SessionStore();
  const gateway = gatewayFactory ? gatewayFactory() : null;
  const state = {
    clientCaps: {},
    clientInfo: null,
    configOptionsBySession: new Map(),
    mcpBySession: new Map(),
    extraToolsBySession: new Map(),
    cancelled: new Set(),
  };
  const missingSession = (id) => protocolError(acp, `Unknown session: ${id}`);

  const notify = (sessionId) => (update) =>
    appConnection?.client.notify("session/update", { sessionId, update }).catch(() => {});

  let appConnection = null;

  const currentGateway = () => {
    if (gateway) return gateway;
    const { baseUrl, apiKey } = resolveCredentials(opts);
    // Lazily created so `authenticate` can update credentials first.
    return require("./gateway/client").createGateway({ baseUrl, apiKey });
  };

  function agentCapabilities() {
    return {
      loadSession: true,
      promptCapabilities: { image: true, audio: false, embeddedContext: true },
      mcpCapabilities: { http: false, sse: false },
      auth: { logout: {} },
      sessionCapabilities: { list: {}, delete: {}, close: {}, resume: {}, additionalDirectories: {} },
    };
  }

  function authMethods() {
    const methods = [{ id: AUTH_AGENT_METHOD, name: "Use 9Router credentials", description: "Reuse the API key stored by `9router acp --login` (or NINE_ROUTER_API_KEY)" }];
    if (state.clientCaps.auth?.terminal) {
      methods.push({
        id: AUTH_TERMINAL_METHOD,
        type: "terminal",
        name: "Log in from the terminal",
        description: "Runs `9router acp --login` so you can point the agent at a gateway",
        args: ["--login"],
        env: { ACP_INTERACTIVE_LOGIN: "1" },
      });
    }
    return methods;
  }

  async function buildOptionsFor(session, { fresh = false } = {}) {
    let models = [];
    try {
      models = await currentGateway().models({ fresh });
    } catch (err) {
      log(`model list unavailable: ${err.message}`);
    }
    const booleanCapable = Boolean(state.clientCaps.session?.configOptions?.boolean);
    const options = buildConfigOptions({
      models,
      currentValue: session.model || undefined,
      tokenSaver: session.tokenSaver !== false,
      booleanCapable,
      fallbackModel: opts.model || undefined,
    });
    state.configOptionsBySession.set(session.id, options);
    return options;
  }

  const app = acp.agent({ name: AGENT_NAME });

  app.onRequest("initialize", (ctx) => {
    state.clientCaps = ctx.params?.clientCapabilities || {};
    state.clientInfo = ctx.params?.clientInfo || null;
    log(`initialize from ${state.clientInfo?.name || "unknown client"}`);
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentInfo: { name: AGENT_NAME, title: AGENT_TITLE, version },
      agentCapabilities: agentCapabilities(),
      authMethods: authMethods(),
    };
  });

  app.onRequest("authenticate", async (ctx) => {
    const creds = resolveCredentials(opts);
    if (creds.apiKey) {
      try {
        await currentGateway().models({ fresh: true });
        log("authenticate: existing credentials accepted");
        return {};
      } catch (err) {
        error(`authenticate: credentials rejected (${err.message})`);
        throw protocolError(
          acp,
          `9Router gateway rejected the credentials (${err.message}). ` +
            `Run \`9router acp --login\`, set NINE_ROUTER_API_KEY, or use the terminal login method.`,
          -32002
        );
      }
    }
    throw protocolError(
      acp,
      "No 9Router API key configured. Run `9router acp --login` or set NINE_ROUTER_API_KEY.",
      -32002
    );
  });

  app.onRequest("logout", () => {
    clearCredentials();
    log("logout: credentials cleared");
    return {};
  });

  app.onRequest("session/new", async (ctx) => {
    const p = ctx.params || {};
    const session = sessions.create({
      cwd: p.cwd,
      mcpServers: p.mcpServers || [],
      additionalDirectories: p.additionalDirectories || [],
    });
    const configOptions = await buildOptionsFor(session);
    if (!session.model) session.model = configOptions.find((o) => o.id === "model")?.currentValue || opts.model || null;
    sessions.persist();

    if (session.mcpServers.length) {
      try {
        const { clients, extraTools } = await startMcpServers(session.mcpServers, {
          cwd: session.cwd,
          log,
        });
        state.mcpBySession.set(session.id, clients);
        state.extraToolsBySession.set(session.id, extraTools);
        log(`session ${session.id}: ${clients.length} MCP server(s), ${extraTools.length} tool(s)`);
      } catch (err) {
        error(`session ${session.id}: MCP startup failed: ${err.message}`);
      }
    }

    return { sessionId: session.id, configOptions };
  });

  app.onRequest("session/load", async (ctx) => {
    const p = ctx.params || {};
    const session = sessions.ensure(p.sessionId);
    if (!session) throw missingSession(p.sessionId);
    if (p.cwd) session.cwd = require("path").resolve(p.cwd);
    const configOptions = await buildOptionsFor(session);
    const send = notify(session.id);
    for (const m of session.messages) {
      if (m.role === "user" && typeof m.content === "string") {
        await send({ sessionUpdate: "user_message_chunk", messageId: randomId("msg_user"), content: { type: "text", text: m.content } });
      } else if (m.role === "assistant") {
        if (m.content) await send({ sessionUpdate: "agent_message_chunk", messageId: randomId("msg_agent"), content: { type: "text", text: String(m.content) } });
        for (const tc of m.tool_calls || []) {
          await send({ sessionUpdate: "tool_call", toolCallId: tc.id, title: tc.function?.name || "tool", status: "completed" });
        }
      }
    }
    return { configOptions };
  });

  app.onRequest("session/resume", async (ctx) => {
    const session = sessions.ensure(ctx.params?.sessionId);
    if (!session) throw missingSession(ctx.params?.sessionId);
    if (ctx.params?.cwd) session.cwd = require("path").resolve(ctx.params.cwd);
    return { configOptions: await buildOptionsFor(session) };
  });

  app.onRequest("session/list", (ctx) => {
    const { cwd, cursor } = ctx.params || {};
    let list = sessions.list();
    // ACP: `cwd` filters to that working directory; a directory no session uses
    // must yield an empty array (never null, never an error).
    if (cwd) {
      const target = path.resolve(cwd);
      list = list.filter((s) => path.resolve(s.cwd || "") === target);
    }
    if (cursor) {
      const idx = list.findIndex((s) => s.sessionId === cursor);
      list = idx >= 0 ? list.slice(idx + 1) : [];
    }
    const page = list.slice(0, PAGE_SIZE);
    const nextCursor = list.length > page.length ? page[page.length - 1].sessionId : null;
    return { sessions: page, ...(nextCursor ? { nextCursor } : {}) };
  });

  app.onRequest("session/delete", (ctx) => {
    const id = ctx.params?.sessionId;
    stopMcpServers(state.mcpBySession.get(id) || []);
    state.mcpBySession.delete(id);
    state.extraToolsBySession.delete(id);
    state.configOptionsBySession.delete(id);
    sessions.delete(id);
    return {};
  });

  app.onRequest("session/close", (ctx) => {
    const id = ctx.params?.sessionId;
    stopMcpServers(state.mcpBySession.get(id) || []);
    state.mcpBySession.delete(id);
    state.cancelled.add(id);
    log(`session ${id}: closed`);
    return {};
  });

  app.onRequest("session/set_config_option", async (ctx) => {
    const { sessionId, configId, value } = ctx.params || {};
    const session = sessions.ensure(sessionId);
    if (!session) throw missingSession(sessionId);
    let options = state.configOptionsBySession.get(sessionId);
    if (!options) options = await buildOptionsFor(session);
    applyConfigValue(options, configId, value);
    if (configId === "model") session.model = String(value);
    if (configId === "_token_saver") session.tokenSaver = value === true || value === "on";
    sessions.touch(session);
    return { configOptions: options };
  });

  app.onRequest("session/set_mode", () => ({}));

  app.onNotification("session/cancel", (ctx) => {
    const id = ctx.params?.sessionId;
    state.cancelled.add(id);
    log(`session ${id}: cancel requested`);
  });

  app.onRequest("session/prompt", async (ctx) => {
    const { sessionId, prompt } = ctx.params || {};
    const session = sessions.ensure(sessionId);
    if (!session) throw missingSession(sessionId);

    state.cancelled.delete(sessionId);
    const external = ctx.signal;
    const ctrl = new AbortController();
    const onExternalAbort = () => ctrl.abort();
    if (external?.aborted) ctrl.abort();
    else external?.addEventListener("abort", onExternalAbort, { once: true });
    const poll = setInterval(() => {
      if (state.cancelled.has(sessionId)) ctrl.abort();
    }, 100);

    const send = notify(sessionId);
    if (!session.title) {
      const title = titleFromPrompt(prompt);
      await send({ sessionUpdate: "session_info_update", title, updatedAt: new Date().toISOString() });
    }

    const gw = currentGateway();
    const toolCtx = {
      session,
      client: ctx.client,
      clientCaps: state.clientCaps,
      gateway: gw,
      signal: ctrl.signal,
      contextLength: 200000,
    };

    try {
      if (!session.model) {
        // Session created while the gateway had no usable model (cold start or
        // outage) — refresh once instead of shipping `model: null` upstream.
        const options = await buildOptionsFor(session, { fresh: true });
        session.model = options.find((o) => o.id === "model")?.currentValue || opts.model || null;
        if (session.model) log(`session ${sessionId}: model recovered (${session.model})`);
      }
      if (!session.model) {
        throw protocolError(
          acp,
          "No model selected: the gateway returned no models. Check that 9Router is running, then pick a model in the agent's model selector.",
          -32001
        );
      }
      const { stopReason } = await runTurn({
        session,
        ctx: toolCtx,
        prompt: prompt || [],
        notify: send,
        extraTools: state.extraToolsBySession.get(sessionId) || [],
      });
      sessions.touch(session, { title: session.title });
      return { stopReason };
    } catch (err) {
      if (ctrl.signal.aborted || err?.cancelled) return { stopReason: "cancelled" };
      error(`session ${sessionId}: turn failed: ${err?.message || err}`);
      if (err instanceof acp.RequestError) throw err;
      throw protocolError(acp, err?.message || String(err), -32002);
    } finally {
      clearInterval(poll);
      external?.removeEventListener("abort", onExternalAbort);
      state.cancelled.delete(sessionId);
      sessions.touch(session, { title: session.title });
    }
  });

  const api = {
    app,
    sessions,
    state,
    connect(stream) {
      appConnection = app.connect(stream);
      return appConnection;
    },
    shutdown() {
      for (const clients of state.mcpBySession.values()) stopMcpServers(clients);
      state.mcpBySession.clear();
    },
    // Exposed for tests.
    __internal: { buildOptionsFor, currentGateway, defaultModel },
  };
  return api;
}

module.exports = { createAgentApp, AUTH_AGENT_METHOD, AUTH_TERMINAL_METHOD };
