import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

describe("Mobile Drawer Accessibility Contract", () => {
  it("verifies inert logic is applied in DashboardLayout", () => {
    const layoutPath = resolve(__dirname, "../../src/shared/components/layouts/DashboardLayout.js");
    const source = readFileSync(layoutPath, "utf-8");
    expect(source).toContain('inert={sidebarOpen ? undefined : "true"}');
    expect(source).toContain('if (e.key === "Escape" && sidebarOpen)');
    expect(source).toContain('menuTrigger.focus()');
  });

  it("verifies Header controls mobile-sidebar", () => {
    const headerPath = resolve(__dirname, "../../src/shared/components/Header.js");
    const source = readFileSync(headerPath, "utf-8");
    expect(source).toContain('aria-controls="mobile-sidebar"');
    expect(source).toContain('aria-expanded={sidebarOpen}');
    expect(source).toContain('aria-label="Open menu"');
  });

  it("verifies Sidebar has matching id", () => {
    const sidebarPath = resolve(__dirname, "../../src/shared/components/Sidebar.js");
    const source = readFileSync(sidebarPath, "utf-8");
    expect(source).toContain('id="mobile-sidebar"');
  });
});