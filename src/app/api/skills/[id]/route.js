import { NextResponse } from "next/server";
import { getAgentSkillById, updateAgentSkill, deleteAgentSkill } from "@/models";
import { fetchSkill, SkillFetchError, estimateTokens } from "@/lib/skills/fetchSkill";

export const dynamic = "force-dynamic";

function toItem(skill) {
  const body = skill.body || "";
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    sourceUrl: skill.sourceUrl,
    rawUrl: skill.rawUrl,
    license: skill.license,
    enabled: skill.enabled,
    bytes: skill.bytes ?? Buffer.byteLength(body, "utf8"),
    tokens: estimateTokens(body),
    preview: body.slice(0, 400),
    fetchedAt: skill.fetchedAt,
    updatedAt: skill.updatedAt,
  };
}

// GET /api/skills/[id] — full document, for the preview panel
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const skill = await getAgentSkillById(id);
    if (!skill) return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    return NextResponse.json({ skill: { ...toItem(skill), body: skill.body || "" } });
  } catch (error) {
    console.log("Error reading agent skill:", error);
    return NextResponse.json({ error: "Failed to read skill" }, { status: 500 });
  }
}

// PATCH /api/skills/[id] — toggle on/off, or re-fetch from source
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const existing = await getAgentSkillById(id);
    if (!existing) return NextResponse.json({ error: "Skill not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const patch = {};

    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;

    // Refresh pulls the document again from the URL it was installed from, so
    // an upstream edit can be taken without removing and re-adding.
    if (body.refresh === true) {
      const fetched = await fetchSkill(existing.rawUrl || existing.sourceUrl);
      patch.name = fetched.name;
      patch.description = fetched.description;
      patch.license = fetched.license;
      patch.body = fetched.body;
      patch.fetchedAt = new Date().toISOString();
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await updateAgentSkill(id, patch);
    return NextResponse.json({ skill: toItem(updated) });
  } catch (error) {
    if (error instanceof SkillFetchError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.log("Error updating agent skill:", error);
    return NextResponse.json({ error: "Failed to update skill" }, { status: 500 });
  }
}

// DELETE /api/skills/[id]
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const removed = await deleteAgentSkill(id);
    if (!removed) return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting agent skill:", error);
    return NextResponse.json({ error: "Failed to delete skill" }, { status: 500 });
  }
}
