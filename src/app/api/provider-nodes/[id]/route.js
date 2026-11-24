import { NextResponse } from "next/server";
import { deleteProviderConnectionsByProvider, deleteProviderNode, getProviderConnections, getProviderNodeById, updateProviderConnection, updateProviderNode, getCustomModels, deleteCustomModel, getModelAliases, deleteModelAlias } from "@/models";
import { normalizeLogo } from "@/shared/utils/providerLogo";
import { isReservedProviderPrefix } from "@/shared/utils/providerPrefix.js";

export const dynamic = "force-dynamic";

// PUT /api/provider-nodes/[id] - Update provider node
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, prefix, apiType, baseUrl, logo, quotaEnabled, quotaPath } = body;

    const node = await getProviderNodeById(id);

    if (!node) {
      return NextResponse.json({ error: "Provider node not found" }, { status: 404 });
    }

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (!prefix?.trim()) {
      return NextResponse.json({ error: "Prefix is required" }, { status: 400 });
    }

    if (isReservedProviderPrefix(prefix)) {
      return NextResponse.json({ error: `The prefix "${prefix.trim()}" is reserved by a built-in provider. Choose a unique prefix for this custom node.` }, { status: 400 });
    }

    // Only validate apiType for OpenAI Compatible nodes
    if (node.type === "openai-compatible" && (!apiType || !["chat", "responses"].includes(apiType))) {
      return NextResponse.json({ error: "Invalid OpenAI compatible API type" }, { status: 400 });
    }

    if (!baseUrl?.trim()) {
      return NextResponse.json({ error: "Base URL is required" }, { status: 400 });
    }

    // An omitted logo leaves the stored one alone, "" clears it
    const normalizedLogo = logo === undefined ? null : normalizeLogo(logo);
    if (normalizedLogo === undefined) {
      return NextResponse.json({ error: "Logo must be a small PNG, JPEG, WebP or GIF data URL" }, { status: 400 });
    }

    let sanitizedBaseUrl = baseUrl.trim();
    
    // Sanitize Base URL for Anthropic Compatible
    if (node.type === "anthropic-compatible") {
      sanitizedBaseUrl = sanitizedBaseUrl.replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/messages")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -9); // remove /messages
      }
    }

    // Sanitize Base URL for Custom Embedding (strip trailing slash and /embeddings)
    if (node.type === "custom-embedding") {
      sanitizedBaseUrl = sanitizedBaseUrl.replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/embeddings")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -"/embeddings".length);
      }
    }

    const updates = {
      name: name.trim(),
      prefix: prefix.trim(),
      baseUrl: sanitizedBaseUrl,
    };
    if (normalizedLogo !== null) updates.logo = normalizedLogo;

    if (node.type === "openai-compatible") {
      updates.apiType = apiType;
    }

    if (node.type === "openai-compatible" || node.type === "anthropic-compatible") {
      // Preserve the existing value when an older client does not send the fields.
      const nextQuotaEnabled = typeof quotaEnabled === "boolean"
        ? quotaEnabled
        : node.quotaEnabled === true;
      let nextQuotaPath = typeof quotaPath === "string" && quotaPath.trim()
        ? quotaPath.trim()
        : (node.quotaPath || "/credits");
      if (!/^https?:\/\//i.test(nextQuotaPath) && !nextQuotaPath.startsWith("/")) {
        nextQuotaPath = `/${nextQuotaPath}`;
      }
      updates.quotaEnabled = nextQuotaEnabled;
      updates.quotaPath = nextQuotaPath;
    }

    const updated = await updateProviderNode(id, updates);

    const connections = await getProviderConnections({ provider: id });
    await Promise.all(connections.map((connection) => (
      updateProviderConnection(connection.id, {
        providerSpecificData: {
          ...(connection.providerSpecificData || {}),
          prefix: prefix.trim(),
          apiType: node.type === "openai-compatible" ? apiType : undefined,
          baseUrl: sanitizedBaseUrl,
          nodeName: updated.name,
          quotaEnabled: updates.quotaEnabled,
          quotaPath: updates.quotaPath,
        }
      })
    )));

    return NextResponse.json({ node: updated });
  } catch (error) {
    console.log("Error updating provider node:", error);
    return NextResponse.json({ error: "Failed to update provider node" }, { status: 500 });
  }
}

// DELETE /api/provider-nodes/[id] - Delete provider node and its connections
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const node = await getProviderNodeById(id);

    if (!node) {
      return NextResponse.json({ error: "Provider node not found" }, { status: 404 });
    }

    await deleteProviderConnectionsByProvider(id);
    await deleteProviderNode(id);

    // Custom models and aliases still pointing at the deleted node id would
    // surface as a ghost compat group in the picker, so remove them as well.
    // TODO: combos and studio targets referencing this node id are left alone
    // because combo members are free-form values and studio targets may point
    // at combos, so pruning them here risks deleting unrelated records.
    try {
      const customModels = await getCustomModels();
      await Promise.all(
        (customModels || [])
          .filter((m) => m?.providerAlias === id)
          .map((m) => deleteCustomModel({ providerAlias: m.providerAlias, id: m.id, type: m.type || "llm" }))
      );
      const aliases = await getModelAliases();
      await Promise.all(
        Object.entries(aliases || {})
          .filter(([, fullModel]) => typeof fullModel === "string" && (fullModel === id || fullModel.startsWith(`${id}/`)))
          .map(([aliasName]) => deleteModelAlias(aliasName))
      );
    } catch (cleanupError) {
      console.log("Error cleaning up models for deleted provider node:", cleanupError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting provider node:", error);
    return NextResponse.json({ error: "Failed to delete provider node" }, { status: 500 });
  }
}
