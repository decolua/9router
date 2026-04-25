import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = path.resolve(process.cwd(), "..");
const read = (p) => fs.readFileSync(path.resolve(ROOT_DIR, p), "utf8");

describe("dashboard shared layout contract", () => {
  it("keeps header compact and semantic typography", () => {
    const header = read("src/shared/components/Header.tsx");
    expect(header).toContain("h-16");
    expect(header).toContain("text-sm");
  });

  it("keeps sidebar labels in canonical muted density", () => {
    const sidebar = read("src/shared/components/Sidebar.tsx");
    expect(sidebar).toContain("text-xs text-muted-foreground");
    expect(sidebar).toContain("className=\"text-xs font-medium\"");
    expect(sidebar).toContain("<SidebarMenu className=\"gap-0.5\">");
    expect(sidebar).toContain("truncate text-xs font-medium text-foreground");
    expect(sidebar).toContain("truncate text-xs text-muted-foreground");
    expect(sidebar).toContain("weight=\"bold\" className={cn(\"size-4\"");
  });

  it("keeps collapsed icon mode at compact density", () => {
    const sidebarUi = read("src/components/ui/sidebar.tsx");
    expect(sidebarUi).toContain("group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2!");
  });

  it("keeps menu actions compact", () => {
    const menu = read("src/shared/components/HeaderMenu.tsx");
    expect(menu).toContain("h-8");
    expect(menu).toContain("text-xs");
  });
});
