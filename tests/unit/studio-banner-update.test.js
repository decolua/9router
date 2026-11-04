import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const v1models = readFileSync(resolve(root, "src/app/api/v1/models/route.js"), "utf8");
const repo = readFileSync(resolve(root, "src/lib/db/repos/modelEditorRepo.js"), "utf8");
const editorRoute = readFileSync(resolve(root, "src/app/api/model-editor/route.js"), "utf8");
const editorPage = readFileSync(
  resolve(root, "src/app/(dashboard)/dashboard/model-editor/page.js"),
  "utf8"
);
const registry = readFileSync(
  resolve(root, "open-sse/providers/registry/antigravity.js"),
  "utf8"
);

describe("studio catalogue: no trace of the upstream model", () => {
  it("stops publishing resolved_model", () => {
    expect(v1models).not.toContain("resolved_model:");
    // the only remaining mention of the target is a code comment explaining why
    // the catalogue must NOT name it - no entry, key, or rendered field may
    expect(v1models).toContain("but the catalogue must not name that target");
    const codeLines = v1models
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"));
    expect(codeLines.join("\n")).not.toContain("studio.targetModel");
  });

  it("stops publishing the fixed model-studio tell", () => {
    expect(v1models).not.toMatch(/owned_by:\s*"model-studio"/);
    expect(v1models).toContain("owned_by: studio.ownedBy || studio.callName");
  });

  it("still routes to the real target, which is never rendered into the listing", () => {
    expect(v1models).toContain("getCapabilitiesForModel(studio.provider, studio.model)");
  });
});

describe("studio owned_by: free-form label, defaulting to the callable name", () => {
  it("survives the record shape and the create/update path", () => {
    expect(repo).toContain('ownedBy: (typeof value.ownedBy === "string"');
    expect(repo).toMatch(/ownedBy: \(ownedBy \|\| ""\)\.trim\(\)/);
    const ownedByInRoute = (editorRoute.match(/ownedBy: body\.ownedBy/g) || []).length;
    expect(ownedByInRoute).toBeGreaterThanOrEqual(2);
  });

  it("the editor exposes ownedBy as a text field, not derived text", () => {
    expect(editorPage).toContain("const [ownedBy");
    expect(editorPage).toContain("ownedBy: ownedBy.trim()");
    expect(editorPage).toMatch(/Owned by/);
    expect(editorPage).toMatch(/Defaults to "/);
    expect(editorPage).not.toMatch(/ownedBy.*=.*targetModel/);
  });
});

describe("banner: cancel, background, and shared look", () => {
  // LongTaskBanner and its Loading.js wrappers are removed (the bell owns long runs), so the
  // assertions that read them are gone. What is left is the contract that survived the removal.
  const layout = readFileSync(
    resolve(root, "src/shared/components/layouts/DashboardLayout.js"),
    "utf8"
  );
  const store = readFileSync(resolve(root, "src/store/taskStore.js"), "utf8");
  const bell = readFileSync(resolve(root, "src/shared/components/NotificationBell.js"), "utf8");
  const pools = readFileSync(
    resolve(root, "src/app/(dashboard)/dashboard/proxy-pools/page.js"),
    "utf8"
  );

  it("the bell renders the store's live tasks instead of a floating dock", () => {
    expect(layout).not.toContain("TaskDock");
    expect(bell).toContain("<NotifToast");
    expect(store).toMatch(/start\(task\)/);
    expect(store).toMatch(/cancel\(id\)/);
  });

  it("the proxy import runs store-driven under a server cancellable job", () => {
    expect(pools).toContain("PROXY_IMPORT_TASK");
    // Cancellation is a server-side dashboard job (cancelProxyImportJob), not a
    // client AbortController: the run keeps going in the background after the
    // operator navigates, and cancel aborts the job from anywhere.
    expect(pools).toContain("onCancel: () => cancelProxyImportJob");
    expect(pools).not.toContain("importProgress");
  });
});

describe("update check: the remote release honours the lookup TTL", () => {
  const check = readFileSync(resolve(root, "src/lib/updateCheck.js"), "utf8");

  it("expires the cached release instead of keeping it for the process lifetime", () => {
    expect(check).toContain("remoteReleaseAt");
    expect(check).toContain("CHECK_TTL_MS");
    // a failed fetch no longer pins the previous answer either
    expect(check).toContain("cache.remoteReleaseAt = 0");
  });
});