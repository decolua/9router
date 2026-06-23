import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import type { McpInstance } from "@/lib/db/repos/mcpInstancesRepo";
import { getInstances, createInstance } from "@/lib/localDb";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9-]{2,40}$/;

const VALID_KINDS = new Set(["http", "sse", "npx", "python", "docker", "command"]);
const VALID_TRANSPORTS = new Set(["http", "sse", "stdio"]);

function stripSecrets(inst: McpInstance | null) {
  if (!inst) return inst;
  const { headers: _h, env: _e, oauthTokens: _o, ...out } = inst;
  void _h; void _e; void _o;
  return out;
}

interface InstancePayload {
  slug?: string;
  kind?: string;
  transport?: string;
  url?: string;
  command?: string;
  [key: string]: JsonValue | undefined;
}

function validatePayload(body: InstancePayload) {
  const errors: string[] = [];
  if (!body.slug || !SLUG_RE.test(body.slug)) {
    errors.push("slug must match ^[a-z0-9-]{2,40}$");
  }
  if (body.slug && body.slug.includes("__")) {
    errors.push("slug cannot contain __ (reserved as tool-name separator)");
  }
  if (!body.kind || !VALID_KINDS.has(body.kind)) {
    errors.push(`kind must be one of: ${[...VALID_KINDS].join(", ")}`);
  }
  const transport = body.transport || (body.kind === "http" || body.kind === "sse" ? body.kind : "stdio");
  if (!VALID_TRANSPORTS.has(transport)) {
    errors.push(`transport must be one of: ${[...VALID_TRANSPORTS].join(", ")}`);
  }
  if (transport === "http" || transport === "sse") {
    if (!body.url) errors.push("url is required for http/sse transport");
  } else {
    if (!body.command) errors.push("command is required for stdio transport");
  }
  return errors;
}

export async function GET(_request: NextRequest, _context: { params: Promise<{}> }) {
  await _context.params;
  try {
    const list = await getInstances();
    return NextResponse.json({ instances: list.map(stripSecrets) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest, _context: { params: Promise<{}> }) {
  await _context.params;
  try {
    const body = await request.json() as InstancePayload;
    const errs = validatePayload(body);
    if (errs.length) return NextResponse.json({ error: errs.join("; ") }, { status: 400 });
    const inst = await createInstance(body);
    return NextResponse.json({ instance: stripSecrets(inst) }, { status: 201 });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err?.code === "DUPLICATE_SLUG") {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
