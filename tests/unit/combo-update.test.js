import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getComboById: vi.fn(),
  getComboByName: vi.fn(),
  updateCombo: vi.fn(),
  deleteCombo: vi.fn(),
  resetComboRotation: vi.fn(),
}));

vi.mock("@/lib/localDb", () => mocks);
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: mocks.resetComboRotation }));

import { PUT } from "../../src/app/api/combos/[id]/route.js";

const models = ["mistral/mistral-medium-latest", "cmc/deepseek/deepseek-v4-pro"];

function saveCombo(id, body) {
  return PUT(new Request(`http://localhost/api/combos/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: String(id) }) });
}

describe("save combo edits", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([5, "5", "f4e0c1e7-1f41-4ab2-9f25-094c3cc145bb"])(
    "keeps its own name when the stored ID is %s", async (id) => {
      const previous = { id, name: "threads-combo", models: [...models].reverse() };
      const body = { name: previous.name, models };
      mocks.getComboByName.mockResolvedValue(previous);
      mocks.getComboById.mockResolvedValue(previous);
      mocks.updateCombo.mockResolvedValue({ ...previous, ...body });

      const response = await saveCombo(id, body);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ...previous, ...body });
      expect(mocks.updateCombo).toHaveBeenCalledWith(String(id), body);
      expect(mocks.resetComboRotation).toHaveBeenCalledWith(previous.name);
    }
  );

  it.each([6, "other-combo-id"])("rejects a name belonging to combo %s", async (id) => {
    mocks.getComboByName.mockResolvedValue({ id, name: "taken" });

    const response = await saveCombo(5, { name: "taken", models });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Combo name already exists" });
    expect(mocks.updateCombo).not.toHaveBeenCalled();
    expect(mocks.resetComboRotation).not.toHaveBeenCalled();
  });

  it("saves a new unused name", async () => {
    mocks.getComboByName.mockResolvedValue(null);
    mocks.getComboById.mockResolvedValue({ id: 5, name: "before", models });
    mocks.updateCombo.mockResolvedValue({ id: 5, name: "after", models });

    const response = await saveCombo(5, { name: "after", models });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 5, name: "after", models });
    expect(mocks.resetComboRotation.mock.calls).toEqual([["before"], ["after"]]);
  });
});
