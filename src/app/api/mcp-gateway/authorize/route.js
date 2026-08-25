// /authorize/route.js
// Claude CLI MCP SDK OAuth flow — auto-approve (no real auth needed)
export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const redirectUri = url.searchParams.get("redirect_uri") || "http://localhost:6274/oauth/callback";
  const clientId = url.searchParams.get("client_id") || "9router-mcp-client";
  const state = url.searchParams.get("state") || "";

  // Auto-approve: redirect back with a dummy auth code
  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set("code", "9router-mcp-auto-auth");
  callbackUrl.searchParams.set("state", state);

  return Response.redirect(callbackUrl.toString(), 302);
}

export async function POST(request) {
  // Some SDK versions POST instead of GET
  const body = await request.json().catch(() => ({}));
  const redirectUri = body.redirect_uri || "http://localhost:6274/oauth/callback";
  const state = body.state || "";

  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set("code", "9router-mcp-auto-auth");
  callbackUrl.searchParams.set("state", state);

  return Response.redirect(callbackUrl.toString(), 302);
}
