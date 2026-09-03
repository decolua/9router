import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdapter: vi.fn(),
}));

vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: mocks.getAdapter,
}));

describe("connection persistence admission fence", () => {
  it("runs the final identity check synchronously inside the DB transaction", async () => {
    let admitDatabase;
    let active = true;
    const db = {
      all: vi.fn(() => []),
      run: vi.fn(),
      transaction: vi.fn((callback) => callback()),
    };
    mocks.getAdapter.mockReturnValue(new Promise((resolve) => { admitDatabase = () => resolve(db); }));
    const { createProviderConnection } = await import("../../src/lib/db/repos/connectionsRepo.js");

    const persistence = createProviderConnection({
      provider: "github",
      authType: "oauth",
      accessToken: "access-token",
      email: "user@example.com",
    }, { beforePersist: () => active });
    active = false;
    admitDatabase();

    await expect(persistence).rejects.toThrow(/cancelled/i);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.all).not.toHaveBeenCalled();
    expect(db.run).not.toHaveBeenCalled();
  });
});
