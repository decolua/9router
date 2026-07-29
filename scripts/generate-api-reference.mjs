import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const apiRoot = path.join(ROOT, "src", "app", "api");
const outFile = path.join(ROOT, "API_REFERENCE.md");

const routes = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === "route.js") routes.push(p);
  }
}
walk(apiRoot);
routes.sort((a, b) => a.localeCompare(b));

const methodRe =
  /export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\b/g;

function methodsOf(file) {
  const s = fs.readFileSync(file, "utf8");
  const m = [...s.matchAll(methodRe)].map((x) => x[1]);
  return [...new Set(m)];
}

/** Next app route file → /api/... URL */
function fileToApiUrl(file) {
  const rel = path.relative(path.join(ROOT, "src", "app", "api"), file);
  const noRoute = rel.replace(/[/\\]route\.js$/i, "");
  const parts = noRoute.split(/[/\\]/).map((seg) => {
    const m = /^\[(.+)\]$/.exec(seg);
    return m ? `{${m[1]}}` : seg;
  });
  return "/api/" + parts.join("/");
}

/** Heuristic: pick best JSDoc block; skip bare CORS-only stubs */
function briefDescription(file, apiUrl) {
  const s = fs.readFileSync(file, "utf8");
  const blocks = [...s.matchAll(/\/\*\*([\s\S]*?)\*\//g)].map((m) => m[1]);
  const pickLine = (body) =>
    body
      .split("\n")
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .find((l) => l && !l.startsWith("@"));

  for (const body of blocks) {
    const flat = body.replace(/\s+/g, " ");
    const line = pickLine(body);
    if (!line) continue;
    if (/Handle CORS preflight/i.test(line) && blocks.length > 1) continue;
    if (/^(GET|POST|PUT|DELETE|PATCH)\s+/i.test(line)) return line.slice(0, 220);
    if (/\b(POST|GET|PUT|DELETE|PATCH)\s+\/api\//i.test(flat)) return line.slice(0, 220);
  }
  if (blocks[0]) {
    const line = pickLine(blocks[0]);
    if (line) return line.replace(/\s+/g, " ").slice(0, 220);
  }
  const one = s.match(/\/\/\s*(.+)/);
  if (one) return one[1].trim().slice(0, 220);
  return `HTTP handler for \`${apiUrl}\`. See source: \`${path.relative(ROOT, file).replace(/\\/g, "/")}\`.`;
}

function v1PublicPath(apiUrl) {
  if (!apiUrl.startsWith("/api/v1")) return null;
  return apiUrl.replace(/^\/api\/v1/, "/v1");
}

function curlFor(method, apiUrl, hasBody) {
  const base = "http://localhost:20128";
  const u = `${base}${apiUrl}`;
  if (method === "GET" || method === "HEAD")
    return `curl -sS -X ${method} "${u}"`;
  if (method === "OPTIONS")
    return `curl -sS -X OPTIONS "${u}" -i`;
  if (method === "DELETE")
    return `curl -sS -X DELETE "${u}"`;
  if (method === "PATCH" || method === "PUT" || method === "POST") {
    if (!hasBody)
      return `curl -sS -X ${method} "${u}" -H "Content-Type: application/json"`;
    return `curl -sS -X ${method} "${u}" -H "Content-Type: application/json" -d @payload.json`;
  }
  return `curl -sS -X ${method} "${u}"`;
}

function examplePayload(apiUrl, method) {
  if (method !== "POST" && method !== "PUT" && method !== "PATCH")
    return { kind: "none" };
  if (apiUrl.includes("/api/v1/api/chat"))
    return {
      kind: "json",
      raw: '{"model":"llama3.2","messages":[{"role":"user","content":"Hi"}]}',
    };
  if (apiUrl.includes("/api/v1/chat/completions"))
    return {
      kind: "json",
      raw: '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hi"}]}',
    };
  if (apiUrl.includes("/api/v1/messages") && !apiUrl.includes("count_tokens"))
    return {
      kind: "json",
      raw: '{"model":"claude-sonnet-4-20250514","max_tokens":256,"messages":[{"role":"user","content":"Hi"}]}',
    };
  if (apiUrl.includes("/api/v1/messages/count_tokens"))
    return {
      kind: "json",
      raw: '{"messages":[{"role":"user","content":"Hello"}]}',
    };
  if (apiUrl.includes("/api/v1/embeddings"))
    return {
      kind: "json",
      raw: '{"model":"text-embedding-3-small","input":"hello world"}',
    };
  if (apiUrl.includes("/api/v1/images/generations"))
    return {
      kind: "json",
      raw: '{"model":"dall-e-3","prompt":"A red circle","n":1,"size":"1024x1024"}',
    };
  if (apiUrl.includes("/api/v1/audio/speech"))
    return {
      kind: "json",
      raw: '{"model":"tts-1","input":"Hello","voice":"alloy"}',
    };
  if (apiUrl.includes("/api/v1/audio/transcriptions")) return { kind: "multipart" };
  if (apiUrl.includes("/api/v1/search"))
    return {
      kind: "json",
      raw: '{"model":"tavily/search","query":"ebRouter","max_results":5}',
    };
  if (apiUrl.includes("/api/v1/web/fetch"))
    return {
      kind: "json",
      raw: '{"model":"jina/reader","url":"https://example.com"}',
    };
  if (apiUrl.includes("/api/v1/responses/compact"))
    return {
      kind: "json",
      raw: '{"model":"gpt-4o","input":[{"role":"user","content":"Hi"}]}',
    };
  if (apiUrl.includes("/api/v1/responses"))
    return {
      kind: "json",
      raw: '{"model":"gpt-4o","input":"Why is the sky blue?"}',
    };
  if (apiUrl.includes("/api/auth/login"))
    return { kind: "json", raw: '{"password":"YOUR_INITIAL_PASSWORD"}' };
  if (apiUrl.includes("/api/auth/logout")) return { kind: "postnobody" };
  return { kind: "json", raw: "{}", note: "inspect route for required JSON fields" };
}

function shellSingleQuote(s) {
  return `'${String(s).replace(/'/g, `'\"'\"'`)}'`;
}

const sections = [];

sections.push(`# HTTP API reference

Auto-generated from \`src/app/api/**/route.js\`. Regenerate:

\`\`\`bash
node scripts/generate-api-reference.mjs
\`\`\`

- **Base URL (local default):** \`http://localhost:20128\`
- **OpenAI-style prefix:** \`/v1/:path*\` rewrites to \`/api/v1/:path*\` (see \`next.config.mjs\`).
- **Auth:** Dashboard routes usually need a session cookie from \`POST /api/auth/login\`. \`/api/v1/*\` may require \`Authorization: Bearer <api key>\` when enabled.

\`\`\`text
-H "Authorization: Bearer YOUR_API_KEY"
\`\`\`

**Payloads:** Examples are minimal. For exact schemas, open the listed \`route.js\` and search for \`request.json()\`, \`request.formData()\`, or \`request.text()\`.

---

`);

for (const file of routes) {
  const apiUrl = fileToApiUrl(file);
  const pub = v1PublicPath(apiUrl);
  const methods = methodsOf(file);
  if (!methods.length) continue;

  const desc = briefDescription(file, apiUrl);
  let block = `## \`${apiUrl}\`\n\n`;
  if (pub) block += `**Also reachable as:** \`${pub}\` (same handler)\n\n`;
  block += `**File:** \`${path.relative(ROOT, file).replace(/\\/g, "/")}\`\n\n`;
  block += `**What it does:** ${desc}\n\n`;
  block += `**Methods:** ${methods.join(", ")}\n\n`;

  for (const m of methods) {
    block += `### ${m}\n\n`;
    const ex = examplePayload(apiUrl, m);
    if (["POST", "PUT", "PATCH"].includes(m)) {
      block += `**Example curl (\`${apiUrl}\`):**\n\n`;
      if (ex.kind === "postnobody") {
        block +=
          "```bash\n" +
          `curl -sS -X ${m} "http://localhost:20128${apiUrl}"` +
          "\n```\n\n";
      } else if (ex.kind === "json") {
        const dq = shellSingleQuote(ex.raw);
        block +=
          "```bash\n" +
          `curl -sS -X ${m} "http://localhost:20128${apiUrl}" -H "Content-Type: application/json" --data-raw ${dq}` +
          "\n```\n\n";
        if (ex.note) block += `*${ex.note}*\n\n`;
      } else if (ex.kind === "multipart") {
        block +=
          "```bash\ncurl -sS -X POST \"" +
          `http://localhost:20128${apiUrl}"` +
          " -F \"file=@./recording.wav\" -F \"model=whisper-1\"\n```\n\n";
      } else {
        block += "```bash\n" + curlFor(m, apiUrl, false) + "\n```\n\n";
      }
    } else {
      block += "```bash\n" + curlFor(m, apiUrl, false) + "\n```\n\n";
    }
  }
  if (pub) {
    block += `**Public path alias:** use \`${pub}\` instead of \`${apiUrl}\` in the URLs above where applicable.\n\n`;
  }
  block += `---\n\n`;
  sections.push(block);
}

fs.writeFileSync(outFile, sections.join(""), "utf8");
console.log("Wrote", outFile, "sections", sections.length - 1);
