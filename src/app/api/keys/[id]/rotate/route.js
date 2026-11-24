import { audit } from "@/lib/observability/audit";
import { requireDashboardAdmin } from "@/dashboardGuard";
import { rotateApiKey } from "@/lib/db/repos/apiKeysRepo.js";

const errors = {
  400: "Expected a positive integer keyVersion",
  401: "Unauthorized",
  403: "Administrator required",
  404: "Key not found",
  409: "Key version changed",
  500: "Failed to rotate key",
  503: "Rotation requires native SQLite",
};
const reply = (status, body = { error: errors[status] }) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request, { params }) {
  try {
    const denied = await requireDashboardAdmin(request, { requireCredential: true });
    if (denied) return reply(denied.status);
    const body = await request.json().catch(() => null);
    if (!Number.isSafeInteger(body?.keyVersion) || body.keyVersion < 1) return reply(400);
    const { id } = await params;
    const { status, ...result } = await rotateApiKey(id, body.keyVersion);
    await audit(request, "key.rotate", { target: id, result: status === 200 ? "success" : "failure" });
    return status === 200 ? reply(status, result) : reply(status);
  } catch {
    return reply(500);
  }
}
