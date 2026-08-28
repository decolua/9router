import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const componentSource = readFileSync(
  new URL("../../src/app/(dashboard)/dashboard/providers/[id]/CompatibleModelsSection.js", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../../src/app/(dashboard)/dashboard/providers/[id]/page.js", import.meta.url),
  "utf8",
);

describe("compatible provider model import wiring", () => {
  it("passes the model creation callback from the provider page", () => {
    expect(pageSource).toContain("onAddCustomModel={(modelId) => handleAddCustomModel");
    expect(componentSource).toMatch(/CompatibleModelsSection\(\{[^}]*onAddCustomModel/);
    expect(componentSource).toContain("onAddCustomModel: PropTypes.func.isRequired");
  });

  it("reports both successful and failed imports", () => {
    expect(componentSource).toContain("notify.success(`已更新 ${importedCount} 个模型`)");
    expect(componentSource).toContain("notify.error(`更新模型列表失败：${error.message || \"未知错误\"}`)");
  });

  it("accepts string and object model entries", () => {
    expect(componentSource).toContain('typeof model === "string" ? model');
  });
});
