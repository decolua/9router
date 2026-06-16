// /.well-known/oauth-authorization-server/route.js
// Universal OAuth server metadata discovery for MCP clients.

export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const origin = url.origin;

  return Response.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/api/mcp-gateway/authorize`,
      token_endpoint: `${origin}/api/mcp-gateway/token`,
      registration_endpoint: `${origin}/api/mcp-gateway/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
      scopes_supported: ["mcp"],
    },
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    }
  );
}
