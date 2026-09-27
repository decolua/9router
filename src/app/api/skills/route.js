import { NextResponse } from "next/server";
import { getAgentSkills, createAgentSkill } from "@/models";
import { fetchSkill, SkillFetchError, estimateTokens } from "@/lib/skills/fetchSkill";

export const dynamic = "force-dynamic";

// The body is the whole point of a skill but it is large and the list view
// does not render it — send a size and a preview instead.
function toListItem(skill) {
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
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
}

// GET /api/skills — list installed agent skills
export async function GET() {
  try {
    const skills = await getAgentSkills();
    const items = skills.map(toListItem);
    return NextResponse.json({
      skills: items,
      // What the enabled set costs on every routed request.
      enabledTokens: items.filter((s) => s.enabled).reduce((n, s) => n + s.tokens, 0),
    });
  } catch (error) {
    console.log("Error listing agent skills:", error);
    return NextResponse.json({ error: "Failed to list skills" }, { status: 500 });
  }
}

// POST /api/skills — install one from a GitHub URL
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const url = String(body.url || "").trim();
    if (!url) return NextResponse.json({ error: "A GitHub URL is required" }, { status: 400 });

    const fetched = await fetchSkill(url, String(body.path || "").trim());

    // The repo publishes several: report them so the caller can pick, rather
    // than silently installing whichever sorted first.
    if (fetched.choices && !body.path) {
      return NextResponse.json({
        needsChoice: true,
        choices: fetched.choices.map((c) => ({ path: c.path, name: c.name })),
      }, { status: 300 });
    }

    const existing = await getAgentSkills();
    if (existing.some((s) => s.rawUrl === fetched.rawUrl)) {
      return NextResponse.json({ error: `"${fetched.name}" is already installed.` }, { status: 409 });
    }

    const created = await createAgentSkill({
      ...fetched,
      sortOrder: existing.length,
      // Installed off. Turning it on is a separate, deliberate action.
      enabled: false,
    });
    return NextResponse.json({ skill: toListItem(created) }, { status: 201 });
  } catch (error) {
    if (error instanceof SkillFetchError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.log("Error installing agent skill:", error);
    return NextResponse.json({ error: "Failed to install skill" }, { status: 500 });
  }
}
