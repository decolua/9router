import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

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
  const { id, name, type, isActive, testStatus, createdAt, updatedAt, ...rest } = s;
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
    [r.id, r.name, r.type, r.isActive, r.testStatus, r.data, r.createdAt, r.updatedAt]
  );
}

export async function getMcpServers(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  if (filter.type) { where.push("type = ?"); params.push(filter.type); }
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
  const allowedFields = ["url", "command", "args", "env", "headers", "description", "toolNames"];
  for (const f of allowedFields) {
    if (data[f] !== undefined && data[f] !== null) server[f] = data[f];
  }
  upsert(db, server);
  return server;
}

export async function updateMcpServer(id, data) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM mcpServers WHERE id = ?`, [id]);
  if (!row) return null;
  const existing = rowToServer(row);
  const merged = { ...existing, ...data, updatedAt: new Date().toISOString() };
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
      // For stdio, try spawning the process briefly
      const { spawn } = await import("child_process");
      return await new Promise((resolve) => {
        const proc = spawn(server.command, server.args || [], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, ...(server.env || {}) },
          timeout: 10000,
        });
        let output = "";
        proc.stdout.on("data", (d) => { output += d.toString(); });
        proc.stderr.on("data", (d) => { output += d.toString(); });
        proc.on("error", (err) => {
          resolve({ ok: false, error: err.message });
        });
        proc.on("close", () => {
          resolve({ ok: true, output: output.slice(0, 500) });
        });
        // Kill after 5 seconds if still running
        setTimeout(() => {
          try { proc.kill(); } catch {}
          resolve({ ok: true, output: output.slice(0, 500) });
        }, 5000);
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
              hint: initRes.status === 401 || initRes.status === 403
                ? "API key may be invalid or missing"
                : undefined,
            };
          }

          // Step 2: List tools (proves auth key works)
          const toolsRes = await fetch(server.url, {
            method: "POST",
            headers,
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
            return { ok: false, status: toolsRes.status, error: `tools/list failed: HTTP ${toolsRes.status}` };
          }

          // Parse SSE or JSON response
          const contentType = toolsRes.headers.get("content-type") || "";
          let result;
          if (contentType.includes("text/event-stream")) {
            const text = await toolsRes.text();
            for (const line of text.split("\n")) {
              if (line.startsWith("data: ")) {
                try { result = JSON.parse(line.slice(6)); } catch {}
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

        // For remote-sse: just GET the endpoint
        const res = await fetch(server.url, {
          method: "GET",
          headers: { Accept: "text/event-stream", ...(server.headers || {}) },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        return { ok: res.ok, status: res.status };
      } catch (err) {
        clearTimeout(timeout);
        return { ok: false, error: err.name === "AbortError" ? "Timeout (15s)" : err.message };
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
