import { NextResponse } from "next/server";
import { getCombos, getProviderConnections, getProviderNodeById, updateProviderConnection, updateProviderNode } from "@/models";
import { deleteProviderNodeWithConnections } from "@/lib/db/repos/nodesRepo.js";
import { buildComboIndex, comboNamesForCandidates } from "@/shared/utils/comboModelLinks.js";

// PUT /api/provider-nodes/[id] - Update provider node
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, prefix, apiType, baseUrl } = body;
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

    // Only validate apiType for OpenAI Compatible nodes
    if (node.type === "openai-compatible" && (!apiType || !["chat", "responses"].includes(apiType))) {
      return NextResponse.json({ error: "Invalid OpenAI compatible API type" }, { status: 400 });
    }

    if (!baseUrl?.trim()) {
      return NextResponse.json({ error: "Base URL is required" }, { status: 400 });
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

    if (node.type === "openai-compatible") {
      updates.apiType = apiType;
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

    // T1.5 §B5: combos storing "prefix/model" members of this node keep
    // pointing at a dead routing target after the node is gone. The
    // transactional prune (combosRepo.removeModelFromCombos, owned by
    // /api/combos/remove-model) is deliberately NOT run from here — silently
    // deleting/rewriting members of the user's saved combos is the bigger
    // surprise; warn instead and let the user prune via the model dialog.
    // Decision recorded in this comment (finding B5, task F6).
    // String members only — the same matching limitation buildComboIndex()/
    // pruneMembers() already carry. Combo list is read outside the delete
    // transaction: a combo created in that window is missed by the WARNING
    // only, never by the data path.
    const orphanCombos = await findCombosUsingPrefix(node.prefix);
    if (orphanCombos.length > 0) {
      console.warn(
        `[provider-nodes] Node "${node.name}" (${id}) deleted, but combo(s) ` +
        `${orphanCombos.map((name) => `"${name}"`).join(", ")} still reference ` +
        `its models ("${node.prefix}/…") and will fail at runtime — remove the model ` +
        `from them or edit the combo manually.`
      );
    }

    // Node + its connections disappear in ONE transaction (T1.5 §B5): the two
    // previously separate writes could half-fail and leave a node without
    // connections or orphan connection rows behind.
    await deleteProviderNodeWithConnections(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting provider node:", error);
    return NextResponse.json({ error: "Failed to delete provider node" }, { status: 500 });
  }
}

async function findCombosUsingPrefix(prefix) {
  if (!prefix) return [];
  const combos = await getCombos();
  const index = buildComboIndex(combos);
  const deadMembers = [...index.keys()].filter(
    (member) => typeof member === "string" && member.startsWith(`${prefix}/`)
  );
  return comboNamesForCandidates(index, deadMembers);
}
