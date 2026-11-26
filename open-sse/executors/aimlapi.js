import { DefaultExecutor } from "./default.js";

// api.aimlapi.com and tools.aimlapi.com negotiate TLS 1.2 with an ECDSA P-256 certificate. The shared
// direct dispatcher pins the ClientHello to X25519 only (DPI workaround), which
// makes Node reject the handshake with ERR_SSL_WRONG_CURVE. Keep X25519 first and
// add P-256 for this provider only, through the existing `directFetch` hook, so the
// shared transport and every other provider stay untouched.
export const AIMLAPI_ECDH_CURVE = "X25519:P-256";
const AIMLAPI_HOSTS = new Set(["api.aimlapi.com", "tools.aimlapi.com"]);

let agent = null;
let undiciFetch = null;

async function getAgent() {
  if (agent) return agent;
  const { Agent } = await import("undici");
  agent = new Agent({
    connect: { autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 250, ecdhCurve: AIMLAPI_ECDH_CURVE },
  });
  return agent;
}

export async function aimlapiDirectFetch(url, options = {}) {
  // The widened curve list is only ever used for the fixed AI/ML API hosts, and
  // redirects are refused so the Bearer key cannot follow one to another host.
  const { hostname, protocol } = new URL(String(url));
  if (protocol !== "https:" || !AIMLAPI_HOSTS.has(hostname)) {
    throw new Error(`AI/ML API transport refused host ${hostname}`);
  }
  undiciFetch ??= (await import("undici")).fetch;
  const { directFetch, proxyUrl, ...rest } = options;
  return undiciFetch(url, { ...rest, redirect: "error", dispatcher: await getAgent() });
}

export class AimlapiExecutor extends DefaultExecutor {
  constructor() {
    super("aimlapi");
  }

  async execute(args) {
    return super.execute({ ...args, directFetch: args.directFetch || aimlapiDirectFetch });
  }
}

export default AimlapiExecutor;
