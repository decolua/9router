import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const landing = read("src/app/landing/page.js");
const hero = read("src/app/landing/components/HeroSection.js");
const flow = read("src/app/landing/components/FlowAnimation.js");
const auth = read("src/shared/components/layouts/AuthLayout.js");
const rootRoute = read("src/app/page.js");
const dashboardGuard = read("src/dashboardGuard.js");

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("neobrutalist landing and active component surfaces", () => {
  it("uses the paper canvas and offers a working dashboard action", () => {
    expect(landing).toContain("bg-transparent");
    expect(hero).toContain('href="/dashboard"');
    expect(hero).toContain("Open dashboard");
    expect(hero).toContain("https://github.com/serenhope/9router");
  });

  it("does not show the v1.0 launch block in the landing hero", () => {
    expect(hero).not.toContain("v1.0 is live");
  });

  it("renders the public landing at root without removing dashboard protection", () => {
    expect(rootRoute).toContain('import LandingPage from "./landing/page";');
    expect(rootRoute).toContain("return <LandingPage />;");
    expect(rootRoute).not.toContain("redirect(");
    expect(dashboardGuard).not.toContain('if (pathname === "/")');
    expect(dashboardGuard).toContain('if (pathname.startsWith("/dashboard"))');
  });

  it("shows a compact route diagram on phones as well as the desktop flow", () => {
    expect(flow).toContain("md:hidden");
    expect(flow).toContain("One request, routed where it fits");
    expect(flow).toContain("9Router hub");
    expect(flow).toContain("md:flex");
  });

  it("removes legacy frosted and blurred surfaces from active source components", () => {
    expect(auth).not.toMatch(/blur-\[/);
    for (const file of sourceFiles(resolve(root, "src"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\bbackdrop-blur(?:-[\w\[\]]+)?\b/);
    }
  });
});
