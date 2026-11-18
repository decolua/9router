import { NextResponse } from "next/server";
import { listBrowserSessions, getBrowserSession, startBrowserSession, closeBrowserSession } from "open-sse/services/webLogin.js";
import remoteLogin from "../../../../../realtime/web-login-websocket.cjs";

const json = (body, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const sameOrigin = (request) => remoteLogin.isSameOrigin(request.headers.get("origin"), request.headers.get("host"));
const failure = (error) => json({ error: error?.message || "Browser session operation failed" }, error instanceof SyntaxError ? 400 : error.status || 500);
const validId = (id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);

export async function GET(request) {
  const id = request.nextUrl.searchParams.get("id");
  if (id === null) return json({ sessions: listBrowserSessions() });
  if (!validId(id)) return json({ error: "Invalid browser session id" }, 400);
  const session = getBrowserSession(id);
  return session ? json(session) : json({ error: "Browser session not found" }, 404);
}

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: "Same-origin request required" }, 403);
  try {
    const body = await request.json();
    return json(await startBrowserSession(body?.profile, body?.url), 202);
  } catch (error) { return failure(error); }
}

export async function DELETE(request) {
  if (!sameOrigin(request)) return json({ error: "Same-origin request required" }, 403);
  const id = request.nextUrl.searchParams.get("id");
  if (!validId(id)) return json({ error: "Invalid browser session id" }, 400);
  return json({ closed: closeBrowserSession(id) });
}
