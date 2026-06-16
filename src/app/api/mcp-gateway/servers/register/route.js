import { validateApiKey, createMcpServer, testMcpServer, updateMcpServer, sanitizeMcpServer } from "@/models";
import { checkRateLimit } from "@/lib/mcp/rateLimiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    // 1. Authenticate Request (Bearer token, x-api-key, x-9r-api-key, x-goog-api-key)
    const authHeader = request.headers.get("Authorization");
    const apiKeyHeader = request.headers.get("x-api-key") || request.headers.get("x-9r-api-key") || request.headers.get("x-goog-api-key");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : apiKeyHeader;

    if (!token) {
      return Response.json(
        { error: "unauthorized", message: "API key or Bearer token is required" },
        { status: 401 }
      );
    }

    const valid = await validateApiKey(token);
    if (!valid) {
      return Response.json(
        { error: "forbidden", message: "Invalid API key" },
        { status: 403 }
      );
    }

    // 2. Rate Limit (60 requests per minute per IP for registration)
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    const rateCheck = checkRateLimit(`mcp:servers:register:${ip}`, {
      maxRequests: 60,
      windowMs: 60 * 1000,
    });

    if (!rateCheck.allowed) {
      return Response.json(
        { error: "rate_limit_exceeded", message: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    // 3. Parse JSON request body
    let body;
    try {
      body = await request.json();
    } catch (err) {
      return Response.json(
        { error: "invalid_request", message: "Invalid JSON body payload" },
        { status: 400 }
      );
    }

    const { name, type, url, command, args, env, headers, description, isActive } = body;

    // Validate name
    if (!name || typeof name !== "string" || name.trim() === "") {
      return Response.json(
        { error: "invalid_request", message: "Parameter 'name' is required and must be a non-empty string" },
        { status: 400 }
      );
    }

    // Validate type
    const validTypes = ["remote-http", "remote-sse", "local-stdio"];
    if (!type || !validTypes.includes(type)) {
      return Response.json(
        { error: "invalid_request", message: `Parameter 'type' must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate type-specific params
    if ((type === "remote-http" || type === "remote-sse") && (!url || typeof url !== "string" || url.trim() === "")) {
      return Response.json(
        { error: "invalid_request", message: "Parameter 'url' is required for remote server types" },
        { status: 400 }
      );
    }

    if (type === "local-stdio" && (!command || typeof command !== "string" || command.trim() === "")) {
      return Response.json(
        { error: "invalid_request", message: "Parameter 'command' is required for local-stdio server type" },
        { status: 400 }
      );
    }

    // 4. Create server entry in the database
    const serverData = {
      name: name.trim(),
      type,
      isActive: isActive !== undefined ? !!isActive : true,
      url: url ? url.trim() : undefined,
      command: command ? command.trim() : undefined,
      args: Array.isArray(args) ? args : undefined,
      env: env && typeof env === "object" ? env : undefined,
      headers: headers && typeof headers === "object" ? headers : undefined,
      description: description ? String(description).trim() : undefined,
    };

    const newServer = await createMcpServer(serverData);

    // 5. Test connectivity immediately if active to guarantee the server is working
    let connectivity = { ok: false, status: "skipped" };
    if (newServer.isActive) {
      try {
        const testResult = await testMcpServer(newServer.id);
        connectivity = {
          ok: testResult.ok,
          error: testResult.error,
          status: testResult.ok ? "healthy" : "failed",
          toolCount: testResult.toolCount || 0,
          tools: testResult.tools || [],
        };
        // Update database with the test outcome
        await updateMcpServer(newServer.id, {
          testStatus: testResult.ok ? "healthy" : "failed",
        });
      } catch (testErr) {
        connectivity = { ok: false, error: testErr.message, status: "failed" };
        await updateMcpServer(newServer.id, { testStatus: "failed" });
      }
    }

    // Fetch updated record with updated testStatus
    const updatedServer = await updateMcpServer(newServer.id, {});

    return Response.json(
      {
        success: true,
        message: "MCP Server registered successfully",
        server: sanitizeMcpServer(updatedServer),
        connectivity,
      },
      { status: 201 }
    );

  } catch (err) {
    console.error("[mcp-gateway] Server registration error:", err);
    return Response.json(
      { error: "internal_server_error", message: err.message },
      { status: 500 }
    );
  }
}
