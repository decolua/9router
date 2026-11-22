import { describe, it, expect } from "vitest";
import { readFileSync, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { formatVersionDate, hideProductReleaseNumbers } from "../../src/shared/components/changelogVersionMetadata.js";

const root = resolve(__dirname, "../..");
const modal = readFileSync(
  resolve(root, "src/shared/components/ChangelogModal.js"),
  "utf8"
);
const changelogRoute = readFileSync(resolve(root, "src/app/api/changelog/route.js"), "utf8");
const languageSwitcher = readFileSync(resolve(root, "src/shared/components/LanguageSwitcher.js"), "utf8");
const localeConfig = readFileSync(resolve(root, "src/i18n/config.js"), "utf8");
const globals = readFileSync(resolve(root, "src/app/globals.css"), "utf8");
const neobrutalism = readFileSync(resolve(root, "src/shared/styles/neobrutalism.css"), "utf8");
const themeStore = readFileSync(resolve(root, "src/store/themeStore.js"), "utf8");
const themeRoute = readFileSync(resolve(root, "src/app/api/theme/route.js"), "utf8");
const layout = readFileSync(resolve(root, "src/app/layout.js"), "utf8");
const dashboardLayout = readFileSync(
  resolve(root, "src/shared/components/layouts/DashboardLayout.js"),
  "utf8"
);
const sidebar = readFileSync(resolve(root, "src/shared/components/Sidebar.js"), "utf8");
const header = readFileSync(resolve(root, "src/shared/components/Header.js"), "utf8");
const headerMenu = readFileSync(resolve(root, "src/shared/components/HeaderMenu.js"), "utf8");
const notificationBell = readFileSync(resolve(root, "src/shared/components/NotificationBell.js"), "utf8");
const arena = readFileSync(resolve(root, "src/app/(dashboard)/dashboard/arena/page.js"), "utf8");
const tokenSaver = readFileSync(resolve(root, "src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js"), "utf8");
const cliTools = readFileSync(resolve(root, "src/app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient.js"), "utf8");
const autoHarvester = readFileSync(resolve(root, "src/app/(dashboard)/dashboard/auto-harvester/page.js"), "utf8");
const mediaProviderCategory = readFileSync(resolve(root, "src/app/(dashboard)/dashboard/media-providers/[kind]/page.js"), "utf8");
const webProviders = readFileSync(resolve(root, "src/app/(dashboard)/dashboard/media-providers/web/page.js"), "utf8");
const translator = readFileSync(resolve(root, "src/app/(dashboard)/dashboard/translator/page.js"), "utf8");
const settings = readFileSync(resolve(root, "src/app/(dashboard)/dashboard/profile/page.js"), "utf8");
const providerList = readFileSync(resolve(root, "src/app/(dashboard)/dashboard/providers/page.js"), "utf8");
const providerForm = readFileSync(resolve(root, "src/app/(dashboard)/dashboard/providers/new/page.js"), "utf8");
const loginPage = readFileSync(resolve(root, "src/app/login/page.js"), "utf8");
const endpointPage = readFileSync(
  resolve(root, "src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js"),
  "utf8"
);

describe("changelog: release cards use date-only titles", () => {
  it("keeps a release number out of the rendered title", () => {
    const renderVersionCards = new Function(
      "splitVersions",
      "escapeHtml",
      "SERENHOPE_SOURCE",
      "commitMetadataForTitle",
      "formatVersionDate",
      "renderBody",
      "foldBody",
      "hideProductReleaseNumbers",
      `${modal.slice(modal.indexOf("function renderVersionCards"), modal.indexOf("\nfunction buildSection"))}\nreturn renderVersionCards;`
    )(
      () => [{ title: "v0.5.420 (2026-11-11) · 2 commits", body: "" }],
      String,
      { id: "serenhope" },
      () => ({ committedAt: "2026-11-13T08:13:14Z" }),
      formatVersionDate,
      () => "",
      () => "",
      hideProductReleaseNumbers
    );
    const html = renderVersionCards("", { border: "#191817", bg: "#ffd45c", color: "#191817", icon: "history" }, "serenhope");

    expect(html).toContain("11 November 2026");
    expect(html).not.toContain("v0.5.420");
    expect(html).not.toMatch(/COMMIT TIME|COMMIT COUNT/);
  });

  it("hides known product releases in notes while preserving unrelated model and package versions", () => {
    const body = "Release 0.5.116 crashed; v0.5.119 fixed it. Use undici 7.30.2 and model-v0.5.116.";
    const result = hideProductReleaseNumbers(body, ["v0.5.119 (2026-11-11)", "v0.5.116 (2026-11-08)"]);
    expect(result).toBe("Release an earlier release crashed; an earlier release fixed it. Use undici 7.30.2 and model-v0.5.116.");
  });

  it("does not show commit time or count metadata in card titles", () => {
    expect(modal).not.toContain("<strong>COMMIT TIME</strong>");
    expect(modal).not.toContain("<strong>COMMIT COUNT</strong>");
    expect(modal).not.toContain("commitTimeContent");
    expect(modal).not.toContain("commitCountText");
  });

  it("keeps fork and upstream changelog sources distinct", () => {
    expect(modal).toContain('const DECOLUA_URL = "https://raw.githubusercontent.com/decolua/9router/refs/heads/master/CHANGELOG.md"');
    expect(modal).toContain('const SERENHOPE_URL = "https://raw.githubusercontent.com/serenhope/9router/refs/heads/master/CHANGELOG.md"');
    expect(changelogRoute).toContain('const OFFICIAL_URL = "https://raw.githubusercontent.com/decolua/9router/refs/heads/master/CHANGELOG.md"');
    expect(modal).toContain("renderVersionCards(md, source.accent, source.id)");
  });

  it("keeps each changelog entry in its own card instead of merging by date", () => {
    expect(modal).toContain("return sections");
    expect(modal).not.toContain("groupByReleaseDate");
    expect(modal).not.toContain("mergeBodiesByCategory");
    expect(modal).not.toContain("group.items.reduce");
  });

  it("styles the changelog with the neobrutalism system and supports Escape", () => {
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain('event.key === "Escape"');
    expect(modal).toContain("shadow-[3px_3px_0_var(--neo-ink)]");
  });

  it("keeps all language names in the selector readable in English", () => {
    expect(languageSwitcher).toContain('"id": { name: "Indonesian" }');
    expect(localeConfig).toContain('id: "Indonesian"');
    expect(languageSwitcher).not.toMatch(/[^\u0000-\u007F]/);
    expect(localeConfig).not.toMatch(/[^\u0000-\u007F]/);
  });

  it("keeps dated fork entries free of product release labels", () => {
    const cl = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
    const headings = cl.split("\n").filter((line) => /^# (?:\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})\b/.test(line));

    expect(headings.length).toBeGreaterThan(300);
    expect(cl).not.toMatch(/\bv0\.5\.\d+\b/i);
    expect(cl).not.toMatch(/^[-*]\s*App version:/im);
  });
});

describe("icon subset: 114 KB instead of the 3.96 MB package font", () => {
  const subset = resolve(root, "public/fonts/material-symbols-subset.woff2");
  const list = resolve(root, "public/fonts/material-symbols-glyphs.txt");

  it("ships a subset well under a quarter MB", () => {
    expect(existsSync(subset)).toBe(true);
    expect(statSync(subset).size).toBeLessThan(250_000);
    expect(statSync(subset).size).toBeGreaterThan(10_000);
  });

  it("covers the menu and model-picker icons", () => {
    const names = new Set(
      readFileSync(list, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
    );
    expect(names.size).toBeGreaterThanOrEqual(140);
    const sidebar = readFileSync(resolve(root, "src/shared/components/Sidebar.js"), "utf8");
    const menuIcons = new Set([...sidebar.matchAll(/\bicon:\s*"([a-z_0-9]+)"/g)].map((match) => match[1]));
    expect(menuIcons.size).toBeGreaterThan(0);
    for (const icon of menuIcons) {
      expect(names.has(icon)).toBe(true);
    }
    expect(names.has("search")).toBe(true);
  });

  it("serves the subset first and keeps the package font as fallback", () => {
    expect(globals).toContain('url("/fonts/material-symbols-subset.woff2")');
    const faces = globals.split("@font-face").slice(1);
    expect(faces.length).toBeGreaterThanOrEqual(2);
    expect(faces[0]).toContain("material-symbols-subset.woff2");
    expect(faces[1]).toContain("material-symbols");
    expect(faces[1]).toContain("node_modules/material-symbols");
  });

  it("enables the rlig feature the font actually ships", () => {
    expect(globals).toMatch(/font-feature-settings:\s*'liga' 1, 'rlig' 1/);
  });

  it("reveals icons from fonts.ready with a hard fallback, never hanging at 0", () => {
    expect(layout).toContain("document.fonts.ready");
    expect(layout).toMatch(/setTimeout\(f,\s*1500\)/);
    // the gate class is always added: ready, catch, and the timer all call f
    expect(layout).toMatch(/r\.classList\.remove\('fonts-loading'\)/);
  });
});

describe("dashboard workspace positioning", () => {
  it("keeps desktop navigation on the left and reveals the mobile drawer from the left", () => {
    expect(dashboardLayout).toContain('className="order-1 hidden shrink-0 lg:flex"');
    expect(dashboardLayout).toContain('<Sidebar side="left" />');
    expect(dashboardLayout).toContain('className="neo-canvas order-2 flex flex-col flex-1');
    expect(dashboardLayout).toContain("fixed inset-y-0 left-0");
    expect(dashboardLayout).toContain('"-translate-x-full"');
    expect(dashboardLayout).toContain('<Sidebar side="left" onClose=');
  });

  it("uses clear comparison language and a balanced responsive model picker", () => {
    expect(arena).toContain("sm:grid-cols-2 lg:grid-cols-1");
    expect(arena).toContain('"lg:col-start-1" : "lg:col-span-2"');
    expect(arena).toContain("Model {index + 1}");
    expect(arena).toContain("Add model");
    expect(arena).toContain('"Run comparison"');
    expect(arena).toContain("Choose model");
    expect(arena).toContain("Comparison results");
    expect(arena).toContain("Total time");
    expect(arena).toContain("First-token time");
    expect(arena).toContain("Estimated cost: ~");
    expect(arena).toContain("Your choice");
    expect(arena).not.toContain("Add contender");
    expect(arena).not.toContain("Run Battle");
    expect(arena).not.toContain("No contender");
  });

  it("keeps the original sidebar logo and visible navigation category headings", () => {
    expect(sidebar).toContain('src="/providers/9router-logo.png"');
    expect(sidebar).toContain("data-dock={side}");
    expect(sidebar).toMatch(/<h2[^>]*>\s*\{title\}/s);
    for (const title of ["Traffic", "Build", "Observe"]) {
      expect(sidebar).toContain(`<NavSection title="${title}"`);
    }
    expect(sidebar).toContain('aria-label="Instance"');
    expect(sidebar).toMatch(/<h2[^>]*>\s*Instance\s*<\/h2>/);
  });

  it("reorders sidebar groups, destinations, and the header menu actions", () => {
    const groupPositions = [
      sidebar.indexOf('<NavSection title="Traffic"'),
      sidebar.indexOf('<NavSection title="Build"'),
      sidebar.indexOf('<NavSection title="Observe"'),
      sidebar.indexOf('aria-label="Instance"'),
    ];
    expect(groupPositions.every((position) => position >= 0)).toBe(true);
    expect(groupPositions).toEqual([...groupPositions].sort((a, b) => a - b));

    const navStart = sidebar.indexOf("const navItems = [");
    const navEnd = sidebar.indexOf("];", navStart);
    const navOrder = sidebar.slice(navStart, navEnd);
    const destinations = [
      "/dashboard/endpoint",
      "/dashboard/providers",
      "/dashboard/combos",
      "/dashboard/usage",
      "/dashboard/quota",
      "/dashboard/cli-tools",
      "/dashboard/token-saver",
    ].map((href) => navOrder.indexOf(href));
    expect(destinations.every((position) => position >= 0)).toBe(true);
    expect(destinations).toEqual([...destinations].sort((a, b) => a - b));

    const menuActions = [
      headerMenu.indexOf('label="Change Log"'),
      headerMenu.indexOf('label="Logout"'),
      headerMenu.indexOf('label="Shutdown"'),
    ];
    expect(menuActions.every((position) => position >= 0)).toBe(true);
    expect(menuActions).toEqual([...menuActions].sort((a, b) => a - b));
  });

  it("places the notification bell to the left of the dotted apps menu", () => {
    const bellPosition = header.indexOf("<NotificationBell");
    const appsMenuPosition = header.indexOf("<HeaderMenu");
    expect(bellPosition).toBeGreaterThanOrEqual(0);
    expect(appsMenuPosition).toBeGreaterThan(bellPosition);
  });

  it("matches the notification bell hit area to the adjacent 40px header control", () => {
    expect(notificationBell).toMatch(/className="[^"]*\bsize-10\b[^"]*"/);
    expect(notificationBell).toContain("notifications_active</span>");
    expect(headerMenu).toContain('className="flex items-center justify-center p-2 rounded-[10px]');
  });

  it("reframes login and gateway access without removing credential routes", () => {
    expect(loginPage).toContain("Sign in to this instance");
    expect(loginPage).toContain("Instance password");
    expect(loginPage).toContain("API key");
    expect(loginPage).toContain("/api/auth/login");
    expect(loginPage).toContain("/api/auth/oidc/start");
    expect(loginPage).toContain("/api/auth/saml/start");
    expect(loginPage).toContain("/api/settings");
    expect(loginPage).not.toContain("seren123");

    expect(endpointPage.indexOf("Traffic desk / 01")).toBeLessThan(
      endpointPage.indexOf("Connection Addresses")
    );
    expect(endpointPage).toContain("Access Keys");
    expect(endpointPage).toContain("Issue Key");
    expect(endpointPage).toContain("handleCreateKey");
    expect(endpointPage).toContain("handleRequireApiKey(!requireApiKey)");
  });

  it("keeps the destination pages in responsive rail-and-work-area compositions", () => {
    expect(tokenSaver).toContain("lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)]");
    expect(cliTools).toContain("lg:grid-cols-12");
    expect(autoHarvester).toContain("lg:grid-cols-[minmax(16rem,0.78fr)_minmax(0,1.7fr)]");
    expect(mediaProviderCategory).toContain("lg:col-span-3");
    expect(mediaProviderCategory).toContain("lg:col-span-9");
    expect(webProviders).toContain("lg:grid-cols-12");
    expect(translator).toContain("xl:grid-cols-2");
    expect(settings).toContain("lg:grid-cols-2");
    expect(providerList).toContain("lg:grid-cols-[minmax(17rem,0.85fr)_minmax(0,3fr)]");
    expect(providerForm).toContain("md:grid-cols-2");
  });

  it("locks the UI to the neobrutalism design system across shared surfaces", () => {
    expect(themeStore).toContain('const THEME_ID = "neobrutalism"');
    expect(themeStore).toContain('root.classList.add(THEME_ID)');
    expect(themeStore).toContain('root.classList.remove("dark", "glass", "brutalist")');
    expect(themeRoute).toContain('{ theme: "neobrutalism" }');
    expect(themeRoute).not.toContain('{ theme: "glass" }');
    expect(layout).toContain("classList.add('neobrutalism')");
    expect(layout).toContain("classList.remove('dark','glass','brutalist')");
    expect(globals).toContain("neobrutalism.css");
    expect(neobrutalism).toContain("backdrop-filter: none !important");
    expect(neobrutalism).toContain("border-radius: 3px !important");
    expect(neobrutalism).toContain("5px 5px 0 var(--neo-ink)");
    expect(neobrutalism).toContain(".neo-panel");
    expect(neobrutalism).toContain(".neo-field");
    expect(sidebar).toContain('src="/providers/9router-logo.png"');
    expect(sidebar).toContain('<NavSection title="Traffic"');
    expect(sidebar).toContain('<NavSection title="Build"');
    expect(sidebar).toContain('<NavSection title="Observe"');
    expect(sidebar).toContain('aria-label="Instance"');
  });
});
