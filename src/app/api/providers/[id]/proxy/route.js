import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";

/**
 * GET /api/providers/[id]/proxy - Get provider proxy config
 */
export async function GET(request, { params }) {
  try {
    const connection = await getProviderConnectionById(params.id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // Return proxy config (without exposing passwords in logs)
    const proxyConfig = connection.proxy || null;
    const safeConfig = proxyConfig
      ? {
          url: proxyConfig.url,
          bypass: proxyConfig.bypass || [],
        }
      : null;

    return NextResponse.json({ proxy: safeConfig });
  } catch (error) {
    console.error("Error getting proxy config:", error);
    return NextResponse.json(
      { error: error.message || "Failed to get proxy config" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/providers/[id]/proxy - Update provider proxy config
 */
export async function PUT(request, { params }) {
  try {
    const body = await request.json();
    const { url, bypass } = body;

    // Validate proxy URL if provided
    if (url) {
      const { validateProxyUrl } = await import("open-sse/utils/proxy-agent-factory.js");
      if (!validateProxyUrl(url)) {
        return NextResponse.json(
          { error: "Invalid proxy URL format" },
          { status: 400 }
        );
      }
    }

    // Validate bypass is array
    if (bypass && !Array.isArray(bypass)) {
      return NextResponse.json(
        { error: "bypass must be an array" },
        { status: 400 }
      );
    }

    const connection = await getProviderConnectionById(params.id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // Build proxy config
    const proxyConfig = url
      ? {
          url,
          bypass: bypass || [],
        }
      : null;

    // Update connection
    const updated = await updateProviderConnection(params.id, {
      proxy: proxyConfig,
    });

    return NextResponse.json({
      success: true,
      proxy: proxyConfig
        ? {
            url: proxyConfig.url,
            bypass: proxyConfig.bypass,
          }
        : null,
    });
  } catch (error) {
    console.error("Error updating proxy config:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update proxy config" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/providers/[id]/proxy - Remove provider proxy config
 */
export async function DELETE(request, { params }) {
  try {
    const connection = await getProviderConnectionById(params.id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // Clear proxy config
    await updateProviderConnection(params.id, {
      proxy: null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting proxy config:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete proxy config" },
      { status: 500 }
    );
  }
}
