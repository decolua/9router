import { describe, expect, it, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  getCombos: vi.fn(),
  createCombo: vi.fn(),
  getComboByName: vi.fn(),
  getComboById: vi.fn(),
  updateCombo: vi.fn(),
  deleteCombo: vi.fn(),
}));

vi.mock("@/lib/localDb", () => db);

const combosRoute = await import("../../src/app/api/combos/route.js");
const comboByIdRoute = await import("../../src/app/api/combos/[id]/route.js");

function request(body) {
  return new Request("http://localhost/api/combos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(response) {
  return await response.json();
}

describe("combo API cycle validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getCombos.mockResolvedValue([]);
    db.getComboByName.mockResolvedValue(null);
  });

  it("rejects creating a combo that includes itself", async () => {
    const response = await combosRoute.POST(request({
      name: "my-combo",
      models: ["my-combo"],
    }));

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({
      error: "Combo circular dependency detected: my-combo -> my-combo",
    });
    expect(db.createCombo).not.toHaveBeenCalled();
  });

  it("rejects updating a combo when the resulting graph would be cyclic", async () => {
    db.getComboById.mockResolvedValue({ id: "a", name: "alpha", models: ["openai/gpt-5"] });
    db.getCombos.mockResolvedValue([
      { id: "a", name: "alpha", models: ["openai/gpt-5"] },
      { id: "b", name: "beta", models: ["alpha"] },
    ]);

    const response = await comboByIdRoute.PUT(
      request({ models: ["beta"] }),
      { params: Promise.resolve({ id: "a" }) },
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({
      error: "Combo circular dependency detected: alpha -> beta -> alpha",
    });
    expect(db.updateCombo).not.toHaveBeenCalled();
  });
});
