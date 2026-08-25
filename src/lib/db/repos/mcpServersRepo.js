import { v4 as uuidv4 } from "uuid";
import { spawn } from "child_process";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import {
  ensureCodeGraphInitialized,
  isCodeGraphServer,
  resolveLocalStdioSpawn,
  validateLocalStdioServer,
  computeBasePrefix,
  normalizePrefix,
  makeUniquePrefix,
} from "@/lib/mcp";

// One-time-per-process guard: assign unique prefixes to any legacy servers
// that predate the prefix feature.
let _prefixBackfillDone = false;

function backfillPrefixes(db) {
  const rows = db.all(`SELECT * FROM mcpServers ORDER BY createdAt ASC`);
  const servers = rows.map(rowToServer);
  const taken = new Set(servers.map((s) => s.prefix).filter(Boolean));
  for (const s of servers) {
    if (!s.prefix) {
      const p = makeUniquePrefix(computeBasePrefix(s.name), taken);
      s.prefix = p;
      taken.add(p);
      upsert(db, s); // persists prefix into the data blob; updatedAt preserved
    }
  }
}

// Collect the prefixes already in use, optionally excluding one server id.
function collectTakenPrefixes(servers, excludeId = null) {
  return new Set(
    servers
      .filter((s) => s.id !== excludeId)
      .map((s) => s.prefix)
      .filter(Boolean),
  );
}

const SENSITIVE_FIELDS = ["apiKey", "accessToken", "headers"];

function rowToServer(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    name: row.name,
    type: row.type,
    isActive: row.isActive === 1 || row.isActive === true,
    testStatus: row.testStatus || "unknown",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serverToRow(s) {
  const {
    id,
    name,
    type,
    isActive,
    testStatus,
    createdAt,
    updatedAt,
    ...rest
  } = s;
  return {
    id,
    name,
    type,
    isActive: isActive === false ? 0 : 1,
    testStatus: testStatus || "unknown",
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

function upsert(db, s) {
  const r = serverToRow(s);
  db.run(
    `INSERT INTO mcpServers(id, name, type, isActive, testStatus, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, type=excluded.type, isActive=excluded.isActive,
       testStatus=excluded.testStatus, data=excluded.data, updatedAt=excluded.updatedAt`,
    [
      r.id,
      r.name,
      r.type,
      r.isActive,
      r.testStatus,
      r.data,
      r.createdAt,
      r.updatedAt,
    ],
  );
}

export async function getMcpServers(filter = {}) {
  const db = await getAdapter();
  if (!_prefixBackfillDone) {
    try {
      backfillPrefixes(db);
    } catch {
      // Non-fatal: getServerPrefix() falls back to a computed base prefix.
    }
    _prefixBackfillDone = true;
  }
  const where = [];
  const params = [];
  if (filter.isActive !== undefined) {
    where.push("isActive = ?");
    params.push(filter.isActive ? 1 : 0);
  }
  if (filter.type) {
    where.push("type = ?");
    params.push(filter.type);
  }
  const sql = `SELECT * FROM mcpServers${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY createdAt DESC`;
  const rows = db.all(sql, params);
  return rows.map(rowToServer);
}

export async function getMcpServerById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM mcpServers WHERE id = ?`, [id]);
  return rowToServer(row);
}

export async function createMcpServer(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const server = {
    id: uuidv4(),
    name: data.name || "Untitled Server",
    type: data.type || "remote-http",
    isActive: data.isActive !== undefined ? data.isActive : true,
    testStatus: data.testStatus || "unknown",
    createdAt: now,
    updatedAt: now,
  };
  // Copy allowed extra fields into data blob
  const allowedFields = [
    "url",
    "command",
    "args",
    "env",
    "headers",
    "description",
    "toolNames",
  ];
  for (const f of allowedFields) {
    if (data[f] !== undefined && data[f] !== null) server[f] = data[f];
  }

  // Assign a unique, persisted prefix. Honor an optional user override,
  // otherwise derive a readable base from the name; append a number on collision.
  const existing = await getMcpServers();
  const taken = collectTakenPrefixes(existing);
  const desiredBase =
    normalizePrefix(data.prefix) || computeBasePrefix(server.name);
  server.prefix = makeUniquePrefix(desiredBase, taken);

  upsert(db, server);
  return server;
}

export async function updateMcpServer(id, data) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM mcpServers WHERE id = ?`, [id]);
  if (!row) return null;
  const existing = rowToServer(row);
  const merged = { ...existing, ...data, updatedAt: new Date().toISOString() };

  // Resolve the prefix: apply a (unique) override if provided, otherwise
  // ensure a legacy server without one gets assigned a prefix now.
  if (data.prefix !== undefined || !existing.prefix) {
    const all = await getMcpServers();
    const taken = collectTakenPrefixes(all, id);
    const desiredBase =
      normalizePrefix(data.prefix) || computeBasePrefix(merged.name);
    merged.prefix = makeUniquePrefix(desiredBase, taken);
  }

  upsert(db, merged);
  return merged;
}

export async function deleteMcpServer(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT id FROM mcpServers WHERE id = ?`, [id]);
  if (!row) return false;
  db.run(`DELETE FROM mcpServers WHERE id = ?`, [id]);
  return true;
}

/**
 * Test connectivity to an MCP server
 * Returns { ok: boolean, error?: string, tools?: string[] }
 */
export async function testMcpServer(id) {
  const server = await getMcpServerById(id);
  if (!server) return { ok: false, error: "Server not found" };

  try {
    if (server.type === "local-stdio") {
      const validation = validateLocalStdioServer(server);
      if (!validation.ok) return { ok: false, error: validation.error };

      if (isCodeGraphServer(server)) {
        ensureCodeGraphInitialized();
      }

      return await new Promise((resolve) => {
        const spawnConfig = resolveLocalStdioSpawn(
          server.command,
          server.args || [],
        );
        const proc = spawn(spawnConfig.command, spawnConfig.args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, ...(server.env || {}) },
          timeout: 45000,
          windowsHide: true,
        });

        let buffer = "";
        let stderrOutput = "";
        let resolved = false;
        let serverInfo = null;

        const timeoutId = setTimeout(() => {
          safeResolve({
            ok: false,
            error: `Timeout waiting for MCP response. Stderr: ${stderrOutput.slice(0, 300)}`,
          });
        }, 40000);

        const cleanup = () => {
          clearTimeout(timeoutId);
          if (!proc.killed && proc.exitCode === null) {
            try {
              proc.kill();
            } catch {}
          }
        };

        const safeResolve = (val) => {
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve(val);
          }
        };

        proc.stdin.on("error", (err) => {
          safeResolve({ ok: false, error: `stdin error: ${err.message}` });
        });

        proc.stdout.on("error", (err) => {
          safeResolve({ ok: false, error: `stdout error: ${err.message}` });
        });

        // Write initialize immediately
        try {
          proc.stdin.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "9router-test", version: "1.0.0" },
              },
            }) + "\n",
          );
        } catch (err) {
          safeResolve({
            ok: false,
            error: `Failed to write initialize: ${err.message}`,
          });
        }

        proc.stdout.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          let idx;
          while ((idx = buffer.indexOf("\n")) >= 0) {
            const raw = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!raw) continue;

            try {
              const response = JSON.parse(raw);
              if (response.id === 1) {
                serverInfo = response.result?.serverInfo;
                // Send initialized notification
                proc.stdin.write(
                  JSON.stringify({
                    jsonrpc: "2.0",
                    method: "notifications/initialized",
                  }) + "\n",
                );
                // Send tools/list request
                proc.stdin.write(
                  JSON.stringify({
                    jsonrpc: "2.0",
                    id: 2,
                    method: "tools/list",
                    params: {},
                  }) + "\n",
                );
              } else if (response.id === 2) {
                const tools = response.result?.tools || [];
                safeResolve({
                  ok: true,
                  toolCount: tools.length,
                  tools: tools.map((t) => t.name),
                  serverInfo,
                });
              }
            } catch {
              // Ignore non-JSON or invalid lines (some servers print debug output to stdout)
            }
          }
        });

        proc.stderr.on("data", (d) => {
          stderrOutput += d.toString();
        });

        proc.on("error", (err) => {
          safeResolve({ ok: false, error: err.message });
        });

        proc.on("close", (code) => {
          safeResolve({
            ok: false,
            error: `Process exited with code ${code}. Stderr: ${stderrOutput.slice(0, 300)}`,
          });
        });
      });
    }

    if (server.url) {
      // For remote servers, send initialize then tools/list to verify full connectivity
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const headers = {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(server.headers || {}),
        };

        if (server.type === "remote-http") {
          // Step 1: Initialize
          const initRes = await fetch(server.url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "initialize",
              params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "9router-test", version: "1.0.0" },
              },
              id: 1,
            }),
            signal: controller.signal,
          });

          if (!initRes.ok) {
            clearTimeout(timeout);
            return {
              ok: false,
              status: initRes.status,
              error: `Initialize failed: HTTP ${initRes.status}`,
              hint:
                initRes.status === 401 || initRes.status === 403
                  ? "API key may be invalid or missing"
                  : undefined,
            };
          }

          // Step 2: List tools (proves auth key works)
          const mcpSessionId = initRes.headers.get("mcp-session-id");
          const toolsHeaders = {
            ...headers,
            ...(mcpSessionId ? { "mcp-session-id": mcpSessionId } : {}),
          };

          const toolsRes = await fetch(server.url, {
            method: "POST",
            headers: toolsHeaders,
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "tools/list",
              params: {},
              id: 2,
            }),
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (!toolsRes.ok) {
            return {
              ok: false,
              status: toolsRes.status,
              error: `tools/list failed: HTTP ${toolsRes.status}`,
            };
          }

          // Parse SSE or JSON response
          const contentType = toolsRes.headers.get("content-type") || "";
          let result;
          if (contentType.includes("text/event-stream")) {
            const text = await toolsRes.text();
            for (const line of text.split("\n")) {
              if (line.startsWith("data: ")) {
                try {
                  result = JSON.parse(line.slice(6));
                } catch {}
              }
            }
          } else {
            result = await toolsRes.json();
          }

          const tools = result?.result?.tools || [];
          return {
            ok: true,
            status: toolsRes.status,
            toolCount: tools.length,
            tools: tools.map((t) => t.name),
            serverInfo: result?.result?.serverInfo,
          };
        }

        // For remote-sse: GET the endpoint, read the endpoint event, then POST initialize & tools/list
        const res = await fetch(server.url, {
          method: "GET",
          headers: { Accept: "text/event-stream", ...(server.headers || {}) },
          signal: controller.signal,
        });

        if (!res.ok) {
          clearTimeout(timeout);
          return {
            ok: false,
            status: res.status,
            error: `Connection failed: HTTP ${res.status}`,
            hint:
              res.status === 401 || res.status === 403
                ? "API key may be invalid or missing"
                : undefined,
          };
        }

        // Read the response stream until we get the "endpoint" event
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        let postUrl = null;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split("\n");
            sseBuffer = lines.pop() || "";

            let currentEvent = "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith("event: ")) {
                currentEvent = trimmed.slice(7).trim();
              } else if (trimmed.startsWith("data: ")) {
                const data = trimmed.slice(6).trim();
                if (currentEvent === "endpoint") {
                  postUrl = new URL(data, server.url).toString();
                  break;
                }
              } else if (trimmed === "") {
                currentEvent = "";
              }
            }

            if (postUrl) break;
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {}
          try {
            await res.body.cancel();
          } catch {}
        }

        if (!postUrl) {
          clearTimeout(timeout);
          return {
            ok: false,
            error: "Failed to receive endpoint event from SSE stream",
          };
        }

        // Now perform HTTP POST handshake via postUrl
        const initRes = await fetch(postUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "9router-test", version: "1.0.0" },
            },
            id: 1,
          }),
          signal: controller.signal,
        });

        if (!initRes.ok) {
          clearTimeout(timeout);
          return {
            ok: false,
            status: initRes.status,
            error: `Initialize POST failed: HTTP ${initRes.status}`,
          };
        }

        const sseMcpSessionId = initRes.headers.get("mcp-session-id");
        const sseToolsHeaders = {
          ...headers,
          ...(sseMcpSessionId ? { "mcp-session-id": sseMcpSessionId } : {}),
        };

        const toolsRes = await fetch(postUrl, {
          method: "POST",
          headers: sseToolsHeaders,
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "tools/list",
            params: {},
            id: 2,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!toolsRes.ok) {
          return {
            ok: false,
            status: toolsRes.status,
            error: `tools/list POST failed: HTTP ${toolsRes.status}`,
          };
        }

        // Parse response (could be JSON or SSE data)
        const contentType = toolsRes.headers.get("content-type") || "";
        let result;
        if (contentType.includes("text/event-stream")) {
          const text = await toolsRes.text();
          for (const line of text.split("\n")) {
            if (line.startsWith("data: ")) {
              try {
                result = JSON.parse(line.slice(6));
              } catch {}
            }
          }
        } else {
          result = await toolsRes.json();
        }

        const tools = result?.result?.tools || [];
        return {
          ok: true,
          status: toolsRes.status,
          toolCount: tools.length,
          tools: tools.map((t) => t.name),
          serverInfo: result?.result?.serverInfo,
        };
      } catch (err) {
        clearTimeout(timeout);
        return {
          ok: false,
          error: err.name === "AbortError" ? "Timeout (15s)" : err.message,
        };
      }
    }

    return { ok: false, error: "No URL or command configured" };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Hide sensitive fields for API responses
 */
export function sanitizeMcpServer(server) {
  if (!server) return null;
  const safe = { ...server };
  if (safe.headers && typeof safe.headers === "object") {
    safe.headers = { ...safe.headers };
    for (const key of Object.keys(safe.headers)) {
      if (/auth|key|token|secret|cookie/i.test(key)) {
        safe.headers[key] = "***";
      }
    }
  }
  return safe;
}
