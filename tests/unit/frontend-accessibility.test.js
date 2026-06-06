import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const read = (path) => readFileSync(join(root, path), "utf8");

describe("frontend accessibility regressions", () => {
  it("exposes the request logs tab from the usage tab switcher", () => {
    const page = read("src/app/(dashboard)/dashboard/usage/page.js");

    expect(page).toMatch(/\{\s*value:\s*"logs",\s*label:\s*"Logs"\s*\}/);
  });

  it("marks sidebar navigation and accordion state for assistive tech", () => {
    const sidebar = read("src/shared/components/Sidebar.js");

    expect(sidebar).toContain('aria-hidden="true"');
    expect(sidebar).toContain('aria-current={isActive(item.href) ? "page" : undefined}');
    expect(sidebar).toContain("aria-expanded={mediaOpen}");
    expect(sidebar).toContain('aria-controls="sidebar-media-providers"');
    expect(sidebar).toContain('id="sidebar-media-providers"');
  });

  it("gives the dashboard menu button and popup menu semantics", () => {
    const menu = read("src/shared/components/HeaderMenu.js");

    expect(menu).toContain('aria-label="Open dashboard menu"');
    expect(menu).toContain('aria-haspopup="menu"');
    expect(menu).toContain("aria-expanded={isOpen}");
    expect(menu).toContain('role="menu"');
    expect(menu).toContain('role="menuitem"');
  });

  it("labels modal dialogs and page search", () => {
    const modal = read("src/shared/components/Modal.js");
    const header = read("src/shared/components/Header.js");

    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain("aria-labelledby={title ? titleId : undefined}");
    expect(header).toContain('aria-label="Search current page"');
  });

  it("does not hide Material Symbols forever if font loading stalls", () => {
    const layout = read("src/app/layout.js");
    const css = read("src/app/globals.css");

    expect(layout).toContain("fonts-failed");
    expect(css).toContain(".fonts-failed .material-symbols-outlined");
  });

  it("marks provider quota controls with menu and icon-only button semantics", () => {
    const providerLimits = read("src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js");

    expect(providerLimits).toContain('role="menu"');
    expect(providerLimits).toContain('role="menuitemradio"');
    expect(providerLimits).toContain("aria-checked={providerFilter === provider}");
    expect(providerLimits).toContain('aria-label={autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh"}');
    expect(providerLimits).toContain('aria-label="Refresh all quotas"');
  });

  it("offers release history upgrade and downgrade controls in the sidebar", () => {
    const sidebar = read("src/shared/components/Sidebar.js");

    expect(sidebar).toContain('fetch("/api/version/releases")');
    expect(sidebar).toContain("selectedReleaseVersion");
    expect(sidebar).toContain("Release history");
    expect(sidebar).toContain("Install & Restart");
    expect(sidebar).toContain('fetch("/api/version/update"');
  });

  it("shows compression stats in the token saver card", () => {
    const endpoint = read("src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js");

    expect(endpoint).toContain('fetch("/api/compression/stats")');
    expect(endpoint).toContain("CompressionStatRow");
    expect(endpoint).toContain("Saved");
    expect(endpoint).toContain("Est. tokens saved");
    expect(endpoint).toContain("Savings not measurable");
    expect(endpoint).toContain("Hits");
    expect(endpoint).toContain("Prompt injections");
  });

  it("marks Headroom as coming soon instead of enabling an offline proxy", () => {
    const endpoint = read("src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js");

    expect(endpoint).toContain("Coming soon");
    expect(endpoint).toContain("Headroom is coming soon");
    expect(endpoint).toContain("disabled");
  });

  it("keeps primary dashboard copy direct and task-oriented", () => {
    const header = read("src/shared/components/Header.js");
    const tools = read("src/shared/constants/cliTools.js");
    const skills = read("src/shared/constants/skills.js");
    const skillsPage = read("src/app/(dashboard)/dashboard/skills/page.js");
    const combined = `${header}\n${tools}\n${skills}\n${skillsPage}`;

    expect(header).toContain("Connect, test, and route AI providers");
    expect(header).toContain("Build ordered model failover chains");
    expect(header).toContain("Review spend, tokens, quota, and request history");
    expect(header).toContain("Install and point local AI tools at 9Router");
    expect(header).toContain("Share ready-to-use capability links with AI agents");
    expect(tools).toContain("Route Antigravity IDE traffic through 9Router");
    expect(skills).toContain("Start here: base URL, auth, model discovery, and every capability link.");
    expect(skillsPage).toContain("Send this to your agent:");
    expect(skillsPage).toContain("Primary skill");
    expect(skillsPage).toContain("Source and examples");

    expect(combined).not.toContain("Manage your AI provider connections");
    expect(combined).not.toContain("Configure CLI tools");
    expect(combined).not.toContain("Copy a link and paste to your AI");
    expect(combined).not.toContain("Paste this to your AI:");
    expect(combined).not.toContain("START HERE");
    expect(combined).not.toContain("More on GitHub");
    expect(combined).not.toContain("with MITM");
    expect(combined).not.toContain("AI Terminal Assistant");
  });

  it("keeps CLI tool descriptions specific", () => {
    const tools = read("src/shared/constants/cliTools.js");
    const toolCards = [
      "ClaudeToolCard",
      "CodexToolCard",
      "OpenCodeToolCard",
      "OpenClawToolCard",
      "DroidToolCard",
      "KiloToolCard",
      "ClineToolCard",
      "DeepSeekTuiToolCard",
      "JcodeToolCard",
    ].map((name) => read(`src/app/(dashboard)/dashboard/cli-tools/components/${name}.js`)).join("\n");

    expect(tools).toContain("Connect Factory Droid to 9Router models");
    expect(tools).toContain("Connect Cline coding sessions");
    expect(tools).toContain("Connect Continue configs to 9Router");
    expect(tools).not.toContain("AI Assistant");
    expect(toolCards).toContain("CliNotDetectedPanel");
    expect(toolCards).not.toContain("Manual configuration is still available if 9router is deployed on a remote server.");
  });

  it("keeps endpoint and provider setup copy plain", () => {
    const endpoint = read("src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js");
    const providers = read("src/app/(dashboard)/dashboard/providers/page.js");
    const newProvider = read("src/app/(dashboard)/dashboard/providers/new/page.js");
    const proxyPools = read("src/app/(dashboard)/dashboard/proxy-pools/page.js");

    expect(endpoint).toContain("Reach it remotely");
    expect(endpoint).toContain("Give teammates a stable URL");
    expect(endpoint).toContain("Point coding tools at it");
    expect(providers).toContain("No providers found for this search");
    expect(providers).toContain("No custom endpoints yet. Add an OpenAI- or Anthropic-compatible endpoint above.");
    expect(newProvider).toContain("Add a provider connection for app and CLI traffic.");
    expect(newProvider).toContain("Optional label for this connection.");
    expect(proxyPools).toContain("Proxy list (one per line)");

    expect(endpoint).not.toContain("Access Anywhere");
    expect(endpoint).not.toContain("Share URL with team members");
    expect(newProvider).not.toContain("Configure a new AI provider to use with your applications.");
    expect(newProvider).not.toContain("identify this configuration");
    expect(proxyPools).not.toContain("Paste Proxy List (One per line)");
  });
});
