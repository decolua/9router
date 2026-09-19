// T1.5 B8 — /api/settings hardening (no password-strength policy — out of scope):
//  1. GET/PATCH 500 leaked `error.message` raw to the client (:34, :116) —
//     internal failure detail belongs in the server log, the body gets a
//     generic message.
//  2. `if (body.newPassword)` is falsy for "" — PATCH { newPassword: "" }
//     answered 200 while silently changing nothing. An explicit empty
//     newPassword must be a 400. (INITIAL_PASSWORD/123456 first-time flow is
//     untouched — documented design, backlog.)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const db = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn() }));

const { GET, PATCH } = await import("@/app/api/settings/route.js");

// Distinctive so a leak can't pass by substring accident.
const RAW_DB_ERROR = "SQLITE_CORRUPT: no such column: mitm_sudo_encrypted at src/lib/db/xx.js";

beforeEach(() => {
  db.getSettings.mockResolvedValue({ requireLogin: true });
  db.updateSettings.mockImplementation(async (patch) => ({ requireLogin: true, ...patch }));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

async function patch(body) {
  const res = await PATCH(
    new Request("http://localhost:20128/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
  );
  return { status: res.status, body: await res.json() };
}

describe("GET /api/settings — no raw error.message in 500 body (B8)", () => {
  it("returns a generic 500 message and logs the real error server-side", async () => {
    db.getSettings.mockRejectedValue(new Error(RAW_DB_ERROR));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain(RAW_DB_ERROR);
    expect(body.error).toBeTruthy();
    expect(log).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: RAW_DB_ERROR }));
  });
});

describe("PATCH /api/settings — no raw error.message in 500 body (B8)", () => {
  it("returns a generic 500 message when updateSettings throws", async () => {
    db.updateSettings.mockRejectedValue(new Error(RAW_DB_ERROR));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await patch({ theme: "dark" });
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain(RAW_DB_ERROR);
    expect(result.body.error).toBeTruthy();
    expect(log).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: RAW_DB_ERROR }));
  });
});

describe("PATCH /api/settings — explicit empty newPassword is a 400 (B8)", () => {
  it('rejects { newPassword: "" } instead of silently answering 200', async () => {
    const result = await patch({ newPassword: "" });
    expect(result.status).toBe(400);
    expect(result.body.error).toBeTruthy();
    expect(db.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects a non-string newPassword without touching the store", async () => {
    const result = await patch({ newPassword: null });
    expect(result.status).toBe(400);
    expect(db.updateSettings).not.toHaveBeenCalled();
  });

  it("still changes only settings when no password fields are sent", async () => {
    const result = await patch({ theme: "dark" });
    expect(result.status).toBe(200);
    expect(result.body.theme).toBe("dark");
    expect(db.updateSettings).toHaveBeenCalledTimes(1);
  });
});
