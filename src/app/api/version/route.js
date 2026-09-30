import { getUpdateInfo } from "@/lib/updateCheck";
import pkg from "../../../../package.json" with { type: "json" };

export const dynamic = "force-dynamic";

// GET /api/version - what the sidebar shows: the running version plus how far
// this install sits behind the repository. A failed lookup answers quietly with
// no update instead of an error, so the dashboard never blocks on GitHub.
export async function GET() {
  try {
    const info = await getUpdateInfo(pkg.version);
    return Response.json({
      currentVersion: info.currentVersion,
      currentRevision: info.currentRevision || null,
      currentRelease: info.currentRelease || null,
      latestVersion: info.latestVersion || info.currentVersion,
      source: info.source || null,
      releaseNotes: Array.isArray(info.releaseNotes) ? info.releaseNotes : [],
      releaseKnown: info.releaseKnown !== false,
      commitMessage: info.commitMessage || "",
      publishedAt: info.publishedAt || "",
      behindBy: Number.isFinite(info.behindBy) ? info.behindBy : null,
      hasUpdate: info.hasUpdate === true,
      revisionKnown: info.revisionKnown !== false,
      lookupFailed: info.lookupFailed === true,
      installCmd: info.installCmd || "",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.log("Error checking version:", error);
    return Response.json({ currentVersion: pkg.version, hasUpdate: false }, { status: 200 });
  }
}
