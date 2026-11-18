import { NextResponse } from "next/server";
import { listBrowserProfiles, createBrowserProfile, renameBrowserProfile, deleteBrowserProfile } from "open-sse/services/webLogin.js";
import remoteLogin from "../../../../../realtime/web-login-websocket.cjs";

const json = (body, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const sameOrigin = (request) => remoteLogin.isSameOrigin(request.headers.get("origin"), request.headers.get("host"));
const failure = (error) => json({ error: error?.message || "Browser profile operation failed" }, error instanceof SyntaxError ? 400 : error.status || 500);

export async function GET() {
  try {
    return json({ profiles: listBrowserProfiles() });
  } catch (error) { return failure(error); }
}

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: "Same-origin request required" }, 403);
  try {
    const body = await request.json();
    return json({ profile: createBrowserProfile(body?.name) }, 201);
  } catch (error) { return failure(error); }
}

export async function PATCH(request) {
  if (!sameOrigin(request)) return json({ error: "Same-origin request required" }, 403);
  try {
    const body = await request.json();
    return json({ profile: renameBrowserProfile(body?.name, body?.newName) });
  } catch (error) { return failure(error); }
}

export async function DELETE(request) {
  if (!sameOrigin(request)) return json({ error: "Same-origin request required" }, 403);
  try {
    return json({ deleted: deleteBrowserProfile(request.nextUrl.searchParams.get("name")) });
  } catch (error) { return failure(error); }
}
