import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import fs from "node:fs";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

// Debug capture: tee request body + response stream to /tmp/claude-debug/
// Set CLAUDE_DEBUG_DUMP=0 to disable.
const DEBUG_DUMP = process.env.CLAUDE_DEBUG_DUMP !== "0";
const DUMP_DIR = "/tmp/claude-debug";
if (DEBUG_DUMP) {
  try { fs.mkdirSync(DUMP_DIR, { recursive: true }); } catch {}
}

function teeResponseBody(response, reqId) {
  if (!DEBUG_DUMP || !response.body) return response;
  const fd = fs.openSync(`${DUMP_DIR}/${reqId}.resp.txt`, "w");
  const reader = response.body.getReader();
  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        try { fs.closeSync(fd); } catch {}
        controller.close();
        return;
      }
      try { fs.writeSync(fd, value); } catch {}
      controller.enqueue(value);
    },
    cancel(reason) {
      try { fs.writeSync(fd, Buffer.from(`\n\n[CANCELLED: ${reason}]\n`)); } catch {}
      try { fs.closeSync(fd); } catch {}
      try { reader.cancel(reason); } catch {}
    },
  });
  return new Response(stream, { status: response.status, headers: response.headers });
}

export async function POST(request) {
  await ensureInitialized();

  let reqId = "";
  if (DEBUG_DUMP) {
    reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const cloned = request.clone();
      const text = await cloned.text();
      const meta = {
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers.entries()),
      };
      fs.writeFileSync(`${DUMP_DIR}/${reqId}.req.json`, `${JSON.stringify(meta, null, 2)}\n\n${text}`);
    } catch {}
  }

  const response = await handleChat(request);
  return teeResponseBody(response, reqId);
}

