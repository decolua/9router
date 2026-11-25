import { expect, it, vi } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { viewerPages, viewerPage } from "@/shared/components/viewer/routes.js";
import { DashboardRoleProvider, effectiveRole, loadDashboardStatus, useDashboardRole } from "@/shared/hooks/useDashboardRole.js";

const src = fileURLToPath(new URL("../../src/", import.meta.url));
const dashboard = join(src, "app/(dashboard)/dashboard");
const shell = join(src, "shared/components/layouts/DashboardLayout.js");
const sidebar = join(src, "shared/components/Sidebar.js");
const read = file => readFileSync(file, "utf8");
const allowed = new Set(["GET /api/auth/status", "GET /api/notifications", "POST /api/auth/logout", "POST /api/locale",
  "GET /api/keys?view=summary", "GET /api/providers/summary", "GET /api/combos", "GET /api/usage/stats"]);

it("shares a status request across consumers and effect replay, failing closed", async () => {
  const pending = { current:null };
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({role:"viewer"}));
  try {
    const [first,second] = await Promise.all([loadDashboardStatus(pending),loadDashboardStatus(pending)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(effectiveRole("admin",first)).toBe("viewer");
    expect(effectiveRole("viewer",{role:"admin"})).toBe("viewer");
    expect(effectiveRole("admin",{role:"admin"})).toBe("admin");
    fetcher.mockRejectedValueOnce(new Error());
    expect(effectiveRole("admin",await loadDashboardStatus({current:null}))).toBeNull();
    function Consumer() { return useDashboardRole().role || "pending"; }
    expect(renderToStaticMarkup(createElement(DashboardRoleProvider, {serverRole:"admin"},createElement(Consumer)))).toBe("pending");
  } finally { fetcher.mockRestore(); }
});

// Follow local imports from the viewer shell, including shared controls and hooks.
// Unknown fetch expressions fail the audit and must be classified before use.
function shellCalls() {
  const seen = new Set(), calls = new Set();
  function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    // Restricted Sidebar returns SidebarFrame before AdminSidebar can mount.
    const source = file === sidebar ? read(file).split("function AdminSidebar(")[0] : read(file);
    for (const [,spec] of source.matchAll(/(?:from\s+|import\s+)["']([^"']+)["']/g)) {
      if (!spec.startsWith("@/") && !spec.startsWith(".")) continue;
      if (file === sidebar && ["@/store/settingsStore", "./Modal", "@/shared/hooks/useCopyToClipboard"].includes(spec)) {
        // These imports belong only to AdminSidebar. Fail if the viewer frame starts using one.
        const body = source.slice(source.indexOf("export default function Sidebar("));
        expect(body).not.toMatch(/useSettingsStore|ConfirmModal|useCopyToClipboard/);
        continue;
      }
      const path = spec.startsWith("@/") ? resolve(src,spec.slice(2)) : resolve(dirname(file),spec);
      const dep = [path+".js",path+"/index.js",path].find(p=>existsSync(p) && p.endsWith(".js"));
      if (dep) visit(dep);
    }
    for (const match of source.matchAll(/\bfetch\(\s*([^,\n)]+)/g)) {
      const expr = match[1];
      const options = source.slice(match.index, source.indexOf(")", match.index));
      const method = /method:\s*"([A-Z]+)"/.exec(options)?.[1] ?? "GET";
      if (expr === "page.api" && file.endsWith("/viewer/ViewerPage.js")) {
        expect(method).toBe("GET");
        continue; // expanded per page
      }
      if (["GITHUB_CONFIG.donateUrl","GITHUB_CONFIG.changelogUrl"].includes(expr) || expr.startsWith("`/i18n/literals/")) continue;
      const url = expr.startsWith("url") && file.endsWith("/NotificationBell.js")
        ? /const url = "([^"]+)"/.exec(source)[1] : /^"([^"]+)"$/.exec(expr)?.[1];
      if ((url === "/api/version/shutdown" && method === "POST") || (url === "/api/notifications" && method === "PATCH")) {
        expect(source.slice(0,match.index)).toMatch(/(?:const handleShutdown = async \(\) =>|async function mark\(id\)) \{\s*if \(!admin\) return;[^}]*$/);
        continue;
      }
      expect(url, relative(src,file)+": "+expr).toBeTruthy();
      calls.add(method+" "+url);
    }
  }
  visit(shell);
  visit(join(src,"shared/components/ThemeProvider.js"));
  visit(join(src,"i18n/RuntimeI18nProvider.js"));
  return [...calls].sort();
}

it("maps every dashboard page to only permitted viewer calls, including layout and menus", () => {
  const layout = read(shell);
  expect(layout).toContain('role === "admin" ? children : <ViewerPage');
  expect(layout).toContain("const viewerHrefs = Object.keys(viewerPages)");
  expect(layout).toContain('const allowedHrefs = role === "admin" ? undefined : viewerHrefs');
  expect(layout.match(/<Sidebar\b[^>]*allowedHrefs=\{allowedHrefs\}/g)).toHaveLength(2);
  const nav = read(sidebar);
  expect(nav).toMatch(/if \(allowedHrefs\) return <SidebarFrame allowedHrefs=\{allowedHrefs\} onClose=\{onClose\} \/>;\s*return <AdminSidebar/);
  expect(nav).toContain("navItems.filter((item) => allowedHrefs.includes(item.href))");
  expect(read(join(src,"shared/components/Header.js"))).toContain('<NotificationBell admin={role === "admin"}');
  expect(read(join(src,"shared/components/Header.js"))).toContain('<HeaderMenu admin={role === "admin"}');
  const common = shellCalls();
  expect(common).toEqual(["GET /api/auth/status","GET /api/notifications","POST /api/auth/logout","POST /api/locale"]);
  const inventory = Object.fromEntries(readdirSync(dashboard,{recursive:true}).filter(p => /(^|\/)page\.js$/.test(p)).map(file => {
    const path = "/dashboard"+file.replace(/(^|\/)page\.js$/,"").replace(/^(.+)/,"/$1");
    const page = viewerPage(path);
    return [path,page ? [...common,"GET "+page.api] : common];
  }));
  expect(Object.keys(inventory).sort()).toContain("/dashboard/providers/[id]");
  expect(Object.keys(viewerPages).sort()).toEqual(["/dashboard/combos","/dashboard/endpoint","/dashboard/providers","/dashboard/usage"]);
  expect(inventory["/dashboard"]).toEqual(inventory["/dashboard/endpoint"]);
  for (const [path, calls] of Object.entries(inventory))
    for (const call of calls) expect(allowed.has(call),path+": "+call).toBe(true);
  for (const p of Object.keys(viewerPages)) expect(inventory[p]).toHaveLength(common.length+1);
  for (const path of ["/dashboard/cli-tools","/dashboard/providers/[id]","/dashboard/mitm","/dashboard/proxy-pools"])
    expect(inventory[path]).toEqual(common);
});
