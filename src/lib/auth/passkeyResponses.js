import { NextResponse } from "next/server";
import { NO_STORE_HEADERS, PasskeyError } from "@/lib/auth/passkey";

// Every passkey endpoint answers no-store: options carry one-time challenges.
export function passkeyJson(body, status = 200, headers = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE_HEADERS, ...headers } });
}

export function lockedResponse(lock) {
  return passkeyJson(
    { error: `Too many failed attempts. Try again in ${lock.retryAfter}s.`, retryAfter: lock.retryAfter },
    429,
    { "Retry-After": String(lock.retryAfter) }
  );
}

// PasskeyError carries a user-facing message; anything else is logged and hidden.
export function passkeyErrorResponse(error, context, fallbackMessage) {
  if (error instanceof PasskeyError) return passkeyJson({ error: error.message }, error.status);
  console.error(`[passkey] ${context}:`, error?.message || error);
  return passkeyJson({ error: fallbackMessage }, 500);
}

export async function readJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}
