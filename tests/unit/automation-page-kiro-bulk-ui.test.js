import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const automationPagePath = resolve(
  process.cwd(),
  "../src/app/(dashboard)/dashboard/automation/page.js"
);
const bulkAccountModalPath = resolve(
  process.cwd(),
  "../src/shared/components/BulkAccountAutomationModal.js"
);

function getKiroPanelSource() {
  const source = readFileSync(automationPagePath, "utf8");
  const start = source.indexOf("function KiroAutomationPanel");
  const end = source.indexOf("function CodeBuddyBulkTokenModal");
  return source.slice(start, end);
}

describe("Kiro automation page bulk login UI", () => {
  it("opens the dedicated bulk account modal from the Kiro Auto Login Bulk card", () => {
    const panel = getKiroPanelSource();

    expect(panel).toContain("const [isBulkOpen, setIsBulkOpen] = useState(false);");
    expect(panel).toMatch(/id:\s*"bulk-account"[\s\S]*?action:\s*\(\)\s*=>\s*setIsBulkOpen\(true\)/);
    expect(panel).toMatch(/<BulkAccountAutomationModal[\s\S]*?provider="kiro"/);
    expect(panel).not.toMatch(/id:\s*"bulk-account"[\s\S]{0,260}openFlow/);
  });

  it("offers Cloakbrowser as a shared bulk automation browser engine", () => {
    const source = readFileSync(bulkAccountModalPath, "utf8");

    expect(source).toContain('{ value: "cloakbrowser", label: "Cloakbrowser (stealth Chromium, anti-bot)" }');
    expect(source).toContain("Cloakbrowser is stealth Chromium; first run downloads ~200MB.");
    expect(source).not.toContain("Camoufox (stealth Firefox, slower)");
  });
});
