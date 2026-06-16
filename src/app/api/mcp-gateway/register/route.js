// /register/route.js
// Claude CLI MCP SDK tries OAuth client registration before connecting.
// Return a valid registration response so the SDK proceeds.

export const dynamic = "force-dynamic";

export async function POST() {
  // Return a valid OAuth 2.0 client registration response (RFC 7591)
  return Response.json(
    {
      client_id: "9router-mcp-client",
      client_name: "9Router MCP Client",
      redirect_uris: [],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    },
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
