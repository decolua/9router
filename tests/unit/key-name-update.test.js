import { describe, expect, it } from "vitest";
import { validateKeyPolicy } from "../../src/shared/utils/keyPolicy.js";
import { KEY_NAME_MAX } from "../../src/shared/utils/keyOwnership.js";

describe("key name in the key policy", () => {
  it("accepts and trims a new name", () => {
    expect(validateKeyPolicy({ name: "  Platform team  " }).value).toEqual({ name: "Platform team" });
  });

  it("leaves the name alone when it is not sent", () => {
    expect(validateKeyPolicy({ owner: "Alex" }).value).not.toHaveProperty("name");
  });

  it.each([["empty", "   "], ["not text", 42], ["null", null], ["too long", "x".repeat(KEY_NAME_MAX + 1)]])(
    "rejects a %s name",
    (_label, name) => {
      expect(validateKeyPolicy({ name }).error).toMatch(/name must be text/);
    },
  );
});
