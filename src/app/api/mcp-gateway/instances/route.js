import { NextResponse } from "next/server";
import { getInstances, createInstance } from "@/lib/localDb";
import { deriveOauthStatus } from "@/lib/mcp/gateway/oauthStatus";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9-]{2,40}$/;

const VALID_KINDS = new Set(["http", "sse", "npx", "python", "docker", "command"]);
const VALID_TRANSPORTS = new Set(["http", "sse", "stdio"]);

function stripSecrets(inst) {
  if (!inst) return inst;
  const { headers: _h, env: _e, oauthTokens: _o, ...out } = inst;
  void _h; void _e;
  out.oauthStatus = deriveOauthStatus(!!inst.oauth, _o);
  return out;
}

function validatePayload(body) {
  const errors = [];
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

export async function GET() {
  try {
    const list = await getInstances();
    return NextResponse.json({ instances: list.map(stripSecrets) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const errs = validatePayload(body);
    if (errs.length) return NextResponse.json({ error: errs.join("; ") }, { status: 400 });
    const inst = await createInstance(body);
    return NextResponse.json({ instance: stripSecrets(inst) }, { status: 201 });
  } catch (e) {
    const err = e && typeof e === "object" ? e : {};
    if (err?.code === "DUPLICATE_SLUG" || /already exists/i.test(err.message || "")) {
      return NextResponse.json({ error: err.message || "slug already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: err.message || String(e) }, { status: 500 });
  }
}
