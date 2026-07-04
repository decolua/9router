import { NextResponse } from "next/server";
import { isSaas } from "@/lib/deploy/deployMode.js";
import { normalizeOrgSlug, validateOrgSlug } from "@/lib/org/slug.js";
import { isSlugAvailable } from "@/lib/db/repos/organizationsRepo.js";

export async function GET(request) {
  if (!isSaas()) {
    return NextResponse.json({ available: false, saas: false });
  }

  const { searchParams } = new URL(request.url);
  const slug = normalizeOrgSlug(searchParams.get("slug") || "");
  if (!slug) {
    return NextResponse.json({ available: false, error: "Slug is required" }, { status: 400 });
  }

  const validation = validateOrgSlug(slug);
  if (!validation.ok) {
    return NextResponse.json({ available: false, error: validation.error }, { status: 400 });
  }

  const available = await isSlugAvailable(slug);
  return NextResponse.json({ available, slug, saas: true });
}
