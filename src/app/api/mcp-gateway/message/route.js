import { getMcpServers, getMcpServerById } from "@/models";
import {
  sendToMcpServer,
  getGatewaySession,
  unregisterGatewaySession,
  handleToolsList,
  handleToolsCall,
  handlePromptsList,
  handlePromptsGet,
  handleResourcesList,
  handleResourceTemplatesList,
  handleResourcesRead,
  handleCompletionComplete,
  checkRateLimit,
  SUPPORTED_PROTOCOL_VERSIONS,
  MAX_BATCH_SIZE,
  negotiateProtocolVersion,
  deriveSessionOwner,
} from "@/lib/mcp";
import { validateApiKey, getComboByName, getCombos } from "@/lib/localDb";
import { isMcpApiKey } from "@/shared/utils/mcpApiKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Debug logging is opt-in and NEVER includes credentials or message payloads.
const DEBUG = process.env.MCP_GATEWAY_DEBUG === "1";

// POST /api/mcp-gateway/message - Unified message routing
// Routes a JSON-RPC request to the appropriate MCP server.
// When __mcpServerId is provided, routes to that specific server.
// For tools/list without __mcpServerId, aggregates from ALL active servers.
// For tools/call, auto-routes based on tool name prefix (e.g. "stitch__create_project").
// Auth: Accepts Bearer token, X-Api-Key, X-9r-Api-Key, or X-Goog-Api-Key headers.
export async function POST(request) {
  try {
    // Auth check: MCP gateway ONLY accepts MCP-kind keys (mcp_ prefix)
    // This is completely separate from v1 API keys (sk- prefix)
    // Extract token from headers
    const authHeader = request.headers.get("Authorization");
    const apiKeyHeader =
      request.headers.get("x-api-key") ||
      request.headers.get("x-9r-api-key") ||
      request.headers.get("x-mcp-api-key");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : apiKeyHeader;

    // SECURITY: Token is REQUIRED - fail closed if not provided
    if (!token) {
      return Response.json(
        {
          error:
            "Authorization required. Provide MCP API key via Authorization: Bearer <key> or x-api-key header",
        },
        { status: 401 },
      );
    }

    // Only accept MCP-kind keys for gateway access
    if (!isMcpApiKey(token)) {
      return Response.json(
        { error: "Invalid API key. MCP gateway requires mcp_ prefix keys" },
        { status: 401 },
      );
    }
    const valid = await validateApiKey(token, "mcp");
    if (!valid) {
      return Response.json(
        { error: "Invalid or inactive MCP API key" },
        { status: 401 },
      );
    }

    // Rate limit: 60 requests per minute per IP
    const ip =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const rateCheck = checkRateLimit(`mcp:message:${ip}`, {
      maxRequests: 60,
      windowMs: 60_000,
    });
    if (!rateCheck.allowed) {
      return Response.json(
        { error: "Rate limit exceeded", retryAfterMs: rateCheck.retryAfterMs },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
            "X-RateLimit-Remaining": String(rateCheck.remaining),
            "X-RateLimit-Reset": String(Date.now() + rateCheck.resetMs),
          },
        },
      );
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId") || request.headers.get("mcp-session-id");
    const comboName = searchParams.get("combo");

    // 1. Content-Type validation
    const contentType = request.headers.get("content-type");
    if (contentType && !contentType.includes("application/json")) {
      return Response.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message: "Unsupported Media Type: Content-Type must be application/json",
          },
          id: null,
        },
        { status: 415 }
      );
    }

    // 2. Accept validation (relaxed check to avoid breaking simple clients)
    const acceptHeader = request.headers.get("accept");
    if (
      acceptHeader &&
      !acceptHeader.includes("application/json") &&
      !acceptHeader.includes("text/event-stream") &&
      !acceptHeader.includes("*/*")
    ) {
      return Response.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Not Acceptable: Client must accept application/json or text/event-stream",
          },
          id: null,
        },
        { status: 406 }
      );
    }

    // 3. mcp-protocol-version validation
    const protocolVersion = request.headers.get("mcp-protocol-version");
    if (protocolVersion && !SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)) {
      return Response.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: `Unsupported protocol version: ${protocolVersion}. Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`,
          },
          id: null,
        },
        { status: 400 }
      );
    }

    // Resolve target combo (explicit parameter takes priority, otherwise use the active database combo)
    let activeCombo = null;
    if (comboName) {
      activeCombo = await getComboByName(comboName);
    } else {
      const combos = await getCombos();
      activeCombo = combos.find((c) => c.kind === "mcp" && c.isActive);
    }

    const text = await request.text();
    if (!text || text.trim() === "") {
      return new Response("", { status: 202 });
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch (err) {
      // Note: never log the raw body — it may contain secrets/PII.
      console.error("[mcp-gateway] JSON parse error:", err.message);
      return Response.json(
        {
          jsonrpc: "2.0",
          error: { code: -32700, message: "Parse error: invalid JSON" },
        },
        { status: 400 },
      );
    }

    // Helper function to process a single JSON-RPC message
    async function processMessage(message) {
      if (!message || typeof message !== "object") {
        return {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Invalid Request" },
        };
      }

      const { __mcpServerId, ...jsonRpc } = message;

      // Intercept client's initialize/initialized notifications
      if (!__mcpServerId && jsonRpc.method === "initialize") {
        const negotiatedVersion = negotiateProtocolVersion(
          jsonRpc.params?.protocolVersion,
        );

        return {
          jsonrpc: "2.0",
          id: jsonRpc.id,
          result: {
            protocolVersion: negotiatedVersion,
            capabilities: {
              tools: { listChanged: true },
              prompts: { listChanged: true },
              resources: { listChanged: true },
              completions: {},
            },
            serverInfo: {
              name: "9router-mcp-gateway",
              version: "1.0.0",
            },
          },
        };
      }

      if (!__mcpServerId && jsonRpc.method === "notifications/initialized") {
        return null;
      }

      // Intercept client's ping requests targeting the gateway
      if (!__mcpServerId && jsonRpc.method === "ping") {
        return {
          jsonrpc: "2.0",
          id: jsonRpc.id,
          result: {},
        };
      }

      // Handle other gateway-targeted notifications (e.g. notifications/message or notifications/*)
      if (
        !__mcpServerId &&
        (jsonRpc.id === undefined ||
          jsonRpc.method === "notifications/message" ||
          jsonRpc.method?.startsWith("notifications/"))
      ) {
        return null;
      }

      // ─── tools/list aggregation ──────────────────────────────────────────
      if (!__mcpServerId && jsonRpc.method === "tools/list") {
        const res = await handleToolsList(jsonRpc, activeCombo);
        return res instanceof Response ? await res.json() : res;
      }

      // ─── tools/call auto-routing ─────────────────────────────────────────
      if (!__mcpServerId && jsonRpc.method === "tools/call") {
        const res = await handleToolsCall(jsonRpc, activeCombo);
        return res instanceof Response ? await res.json() : res;
      }

      // ─── prompts/list aggregation ────────────────────────────────────────
      if (!__mcpServerId && jsonRpc.method === "prompts/list") {
        const res = await handlePromptsList(jsonRpc);
        return res instanceof Response ? await res.json() : res;
      }

      // ─── prompts/get auto-routing ────────────────────────────────────────
      if (!__mcpServerId && jsonRpc.method === "prompts/get") {
        const res = await handlePromptsGet(jsonRpc);
        return res instanceof Response ? await res.json() : res;
      }

      // ─── resources/list aggregation ──────────────────────────────────────
      if (!__mcpServerId && jsonRpc.method === "resources/list") {
        const res = await handleResourcesList(jsonRpc);
        return res instanceof Response ? await res.json() : res;
      }

      // ─── resources/templates/list aggregation ────────────────────────────
      if (!__mcpServerId && jsonRpc.method === "resources/templates/list") {
        const res = await handleResourceTemplatesList(jsonRpc);
        return res instanceof Response ? await res.json() : res;
      }

      // ─── resources/read auto-routing ─────────────────────────────────────
      if (!__mcpServerId && jsonRpc.method === "resources/read") {
        const res = await handleResourcesRead(jsonRpc);
        return res instanceof Response ? await res.json() : res;
      }

      // ─── completion/complete auto-routing ────────────────────────────────
      if (!__mcpServerId && jsonRpc.method === "completion/complete") {
        const res = await handleCompletionComplete(jsonRpc);
        return res instanceof Response ? await res.json() : res;
      }

      // ─── Direct routing ──────────────────────────────────────────────────
      let server;
      if (__mcpServerId) {
        server = await getMcpServerById(__mcpServerId);
        if (!server) {
          return {
            jsonrpc: "2.0",
            id: jsonRpc.id,
            error: { code: -32602, message: `Unknown MCP server: ${__mcpServerId}` },
          };
        }
      } else {
        const servers = await getMcpServers({ isActive: true });
        if (servers.length === 0) {
          return {
            jsonrpc: "2.0",
            id: jsonRpc.id,
            error: { code: -32000, message: "No active MCP servers configured" },
          };
        }
        server = servers[0];
      }

      if (!server.isActive) {
        return {
          jsonrpc: "2.0",
          id: jsonRpc.id,
          error: { code: -32000, message: "MCP server is disabled" },
        };
      }

      const res = await sendToMcpServer(server, jsonRpc);
      return res instanceof Response ? await res.json() : res;
    }

    // Resolve active SSE session. A session id is optional (stateless JSON
    // POSTs are allowed), but when one is supplied it MUST exist and be owned
    // by the same API key that created it. Otherwise respond 404 to avoid
    // leaking session existence and to block cross-key response injection.
    let sseSession = null;
    if (sessionId) {
      const ownerId = deriveSessionOwner(token);
      const candidate = getGatewaySession(sessionId);
      if (!candidate || (candidate.ownerId && candidate.ownerId !== ownerId)) {
        return Response.json(
          {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32001, message: "Session not found" },
          },
          { status: 404 },
        );
      }
      sseSession = candidate;
    }

    // Helper function to route response to SSE if session is active
    async function sendResponse(data) {
      if (!data) return null;

      if (sseSession) {
        try {
          sseSession.send(`event: message\ndata: ${JSON.stringify(data)}\n\n`);
        } catch (err) {
          console.warn("[mcp-gateway] failed to send response to SSE session:", err.message);
        }
      }

      return data;
    }

    const isBatch = Array.isArray(body);
    const messages = isBatch ? body : [body];

    // Guard against oversized batches (amplification) and multiple inits.
    if (messages.length === 0) {
      return new Response("", { status: 202 });
    }
    if (messages.length > MAX_BATCH_SIZE) {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32600,
            message: `Invalid Request: batch exceeds maximum of ${MAX_BATCH_SIZE} messages`,
          },
        },
        { status: 400 },
      );
    }
    const initCount = messages.filter(
      (m) => m && typeof m === "object" && m.method === "initialize",
    ).length;
    if (initCount > 1) {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32600,
            message: "Invalid Request: Only one initialization request is allowed",
          },
        },
        { status: 400 },
      );
    }

    if (DEBUG) {
      // Method names only — never arguments, headers, or auth.
      console.log(
        "[mcp-gateway] dispatch:",
        messages.map((m) => m?.method || "<response>").join(", "),
      );
    }

    const results = await Promise.all(
      messages.map(async (msg) => {
        try {
          const res = await processMessage(msg);
          return await sendResponse(res);
        } catch (err) {
          const errRes = {
            jsonrpc: "2.0",
            id: msg?.id || null,
            error: { code: -32603, message: err.message },
          };
          return await sendResponse(errRes);
        }
      })
    );

    const validResults = results.filter((res) => res !== null && res !== undefined);

    if (isBatch) {
      if (validResults.length > 0) {
        return Response.json(validResults);
      }
      return new Response("", { status: 202 });
    } else {
      if (validResults.length > 0) {
        return Response.json(validResults[0]);
      }
      return new Response("", { status: 202 });
    }
  } catch (e) {
    console.error("[mcp-gateway] POST error:", e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/mcp-gateway - Terminate session
export async function DELETE(request) {
  try {
    const authHeader = request.headers.get("Authorization");
    const apiKeyHeader =
      request.headers.get("x-api-key") ||
      request.headers.get("x-9r-api-key") ||
      request.headers.get("x-mcp-api-key");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : apiKeyHeader;

    if (!token) {
      return Response.json(
        { error: "Authorization required" },
        { status: 401 }
      );
    }

    if (!isMcpApiKey(token)) {
      return Response.json(
        { error: "Invalid API key. MCP gateway requires mcp_ prefix keys" },
        { status: 401 }
      );
    }
    const valid = await validateApiKey(token, "mcp");
    if (!valid) {
      return Response.json(
        { error: "Invalid or inactive MCP API key" },
        { status: 401 }
      );
    }

    // Validate protocol version (parity with the SDK's handleDeleteRequest)
    const protocolVersion = request.headers.get("mcp-protocol-version");
    if (
      protocolVersion &&
      !SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)
    ) {
      return Response.json(
        {
          error: `Unsupported protocol version: ${protocolVersion}. Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`,
        },
        { status: 400 },
      );
    }

    const { searchParams } = new URL(request.url);
    const sessionId =
      searchParams.get("sessionId") || request.headers.get("mcp-session-id");

    if (!sessionId) {
      return Response.json(
        { error: "Bad Request: Mcp-Session-Id is required" },
        { status: 400 },
      );
    }

    // Only the API key that created the session may terminate it. Unknown or
    // non-owned sessions return 404 (do not reveal existence to other keys).
    const ownerId = deriveSessionOwner(token);
    const session = getGatewaySession(sessionId);
    if (!session || (session.ownerId && session.ownerId !== ownerId)) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    unregisterGatewaySession(sessionId);

    return new Response(null, { status: 200 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
