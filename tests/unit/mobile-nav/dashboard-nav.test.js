import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

describe("DashboardLayout mobile navigation component classes", () => {
  it("does not hardcode 'transform' utility that breaks Tailwind 4 dynamic classes", () => {
    // Read the actual production code of DashboardLayout
    const layoutPath = path.resolve(__dirname, "../../../src/shared/components/layouts/DashboardLayout.js");
    const layoutCode = fs.readFileSync(layoutPath, "utf-8");

    // The component should map translate-x-0 and -translate-x-full based on state
    expect(layoutCode).toContain("sidebarOpen ? \"translate-x-0\" : \"-translate-x-full\"");
    
    // We expect the drawer container to not have the literal `transform` class anymore,
    // because in Tailwind 4 `transform` is no longer needed to enable transforms,
    // and specifying it statically was interfering with dynamic variable assignment 
    // for `translate-x` updates in this project.
    
    // Find the class string block defining the mobile sidebar wrapper
    const sidebarMatch = layoutCode.match(/className=\{`fixed inset-y-0 left-0 z-50[^`]+`\}/);
    expect(sidebarMatch).toBeTruthy();
    
    const classNameString = sidebarMatch[0];
    
    // Must contain the expected positioning and transition logic
    expect(classNameString).toContain("lg:hidden");
    expect(classNameString).toContain("transition-transform");
    
    // Crucially: MUST NOT contain the 'transform' keyword, but allows transition-transform
    // We replace 'transition-transform' with empty string first to avoid matching it
    const classNamesWithoutTransition = classNameString.replace(/transition-transform/g, '');
    expect(classNamesWithoutTransition).not.toMatch(/\btransform\b/);
  });
});
