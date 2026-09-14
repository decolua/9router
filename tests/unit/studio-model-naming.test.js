import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// A custom model is its own model: the name is what callers and the dashboards see,
// the base model behind it stays internal.
const originalDataDir = process.env.DATA_DIR;

let ctx;

beforeEach(async () => {
 const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-studio-naming-"));
 process.env.DATA_DIR = tempDir;
 vi.resetModules();
 const db = await import("@/lib/db/index.js");
 const editor = await import("@/lib/db/repos/modelEditorRepo.js");
 const node = await db.createProviderNode({
 name: "Oss Node", type: "openai-compatible", prefix: "ossnode", apiType: "chat", baseUrl: "https://upstream.test/v1",
 });
 ctx = { db, editor, nodeId: node.id, tempDir };
}, 60_000);

afterEach(() => {
 fs.rmSync(ctx.tempDir, { recursive: true, force: true });
 if (originalDataDir === undefined) delete process.env.DATA_DIR;
 else process.env.DATA_DIR = originalDataDir;
});

async function addStudio(callName, targetModel) {
 await ctx.editor.setStudioModel({
 callName, displayName: "", targetModel, targetLabel: targetModel, contextWindow: 0, systemPrompt: "",
 });
}

describe("custom model resolution", () => {
 it("resolves a target typed with a node prefix to that node", async () => {
 await addStudio("claude-sonnet-5", "ossnode/gpt-oss-120b");
 const { getModelInfo } = await import("@/sse/services/model.js");
 expect(await getModelInfo("claude-sonnet-5")).toEqual({ provider: ctx.nodeId, model: "gpt-oss-120b" });
 });

 it("resolves a target typed as a resolved connection id", async () => {
 await addStudio("claude-sonnet-5", `${ctx.nodeId}/gpt-oss-120b`);
 const { getModelInfo } = await import("@/sse/services/model.js");
 expect(await getModelInfo("claude-sonnet-5")).toEqual({ provider: ctx.nodeId, model: "gpt-oss-120b" });
 });

 it("stops chaining custom names instead of looping forever", async () => {
 await addStudio("loop-a", "ossnode/loop-b");
 await addStudio("loop-b", "ossnode/loop-a");
 const { getModelInfo } = await import("@/sse/services/model.js");
 // A cycle has to fall through to the plain resolver rather than blow the stack.
 expect(await getModelInfo("loop-a")).toBeTruthy();
 });
});

describe("usage naming", () => {
 it("bills a custom name under that name and records the base model beside it", async () => {
 const { saveRequestUsage, getUsageHistory } = await import("@/lib/db/repos/usageRepo.js");
 await saveRequestUsage({
 provider: ctx.nodeId,
 model: "gpt-oss-120b",
 requestedModel: "claude-sonnet-5",
 tokens: { prompt_tokens: 5, completion_tokens: 7 },
 timestamp: new Date().toISOString(),
 });
 const rows = await getUsageHistory({ limit: 5 });
 const row = rows.find((r) => r.model === "claude-sonnet-5");
 expect(row).toBeDefined();
 expect(row.resolvedModel).toBe("gpt-oss-120b");
 expect(rows.some((r) => r.model === "gpt-oss-120b")).toBe(false);
 });

 it("keeps an ordinary call named exactly as it was made", async () => {
 const { saveRequestUsage, getUsageHistory } = await import("@/lib/db/repos/usageRepo.js");
 await saveRequestUsage({
 provider: ctx.nodeId,
 model: "gpt-oss-120b",
 tokens: { prompt_tokens: 2, completion_tokens: 3 },
 timestamp: new Date().toISOString(),
 });
 const rows = await getUsageHistory({ limit: 5 });
 expect(rows.some((r) => r.model === "gpt-oss-120b")).toBe(true);
 });
});

describe("response naming", () => {
 it("answers with the name the caller spoke", async () => {
 const { applyModelAlias, calledModelName } = await import("open-sse/utils/modelAlias.js");
 expect(calledModelName("claude-sonnet-5", "gpt-oss-120b")).toBe("claude-sonnet-5");
 expect(calledModelName("gpt-oss-120b", "gpt-oss-120b")).toBeNull();
// the helper mutates in place and reports whether anything changed
 const chunk = { choices: [], model: "gpt-oss-120b" };
 expect(applyModelAlias(chunk, "claude-sonnet-5")).toBe(true);
 expect(chunk.model).toBe("claude-sonnet-5");
 expect(applyModelAlias(chunk, "claude-sonnet-5")).toBe(false);
 const claude = { type: "message_start", message: { model: "gpt-oss-120b" } };
 applyModelAlias(claude, "claude-sonnet-5");
 expect(claude.message.model).toBe("claude-sonnet-5");
 expect(applyModelAlias({ model: "x" }, null)).toBe(false);
 });
});

describe("two custom names on one model", () => {
 async function addNamed(callName) {
 await ctx.editor.setStudioModel({
 callName, displayName: "", targetModel: "ossnode/gpt-oss-120b",
 targetLabel: "ossnode/gpt-oss-120b", contextWindow: 0, systemPrompt: "",
 });
 }

 it("keeps a leftover display alias from renaming its sibling", async () => {
 const { setModelAlias, getModelAliases } = await import("@/lib/db/repos/aliasRepo.js");
 await addNamed("model-1");
 await addNamed("model-2");
 // an older build stored one alias per studio name, and the first match won
 await setModelAlias("model-1", "ossnode/gpt-oss-120b");
 await setModelAlias("model-2", "ossnode/gpt-oss-120b");
 await ctx.editor.getStudioModels();
 const aliases = await getModelAliases();
 expect(aliases["model-1"]).toBeUndefined();
 expect(aliases["model-2"]).toBeUndefined();
 const { getStudioModel } = await import("@/lib/db/repos/modelEditorRepo.js");
 const one = await getStudioModel("model-1");
 const two = await getStudioModel("model-2");
 expect(one.callName).toBe("model-1");
 expect(two.callName).toBe("model-2");
 expect(one.targetModel).toBe(two.targetModel);
 });

 it("bills each name under itself, with the shared model beside it", async () => {
 const { saveRequestUsage, getUsageHistory } = await import("@/lib/db/repos/usageRepo.js");
 const stamp = Date.now();
 for (const [offset, name] of ["model-1", "model-2"].entries()) {
 await saveRequestUsage({
 provider: ctx.nodeId,
 model: "gpt-oss-120b",
 requestedModel: name,
 tokens: { prompt_tokens: 4 + offset, completion_tokens: 9 },
 timestamp: new Date(stamp + offset).toISOString(),
 });
 }
 // the adapter is cached on global, so only look at what this call wrote
 const rows = (await getUsageHistory()).filter((r) => Number(new Date(r.timestamp)) >= stamp);
 expect(rows.map((r) => r.model).sort()).toEqual(["model-1", "model-2"]);
 expect(rows.every((r) => r.resolvedModel === "gpt-oss-120b")).toBe(true);
 });
});

describe("per-key model visibility", () => {
 it("reads the allow list the way the request gate does", async () => {
 const { parseAllowedModels, matchesAllowedModels } = await import("@/lib/db/repos/apiKeysRepo.js");
 expect(parseAllowedModels("*")).toBeNull();
 expect(parseAllowedModels("")).toBeNull();
 expect(parseAllowedModels(" a , B* ")).toEqual(["a", "b*"]);
 const patterns = parseAllowedModels("claude-fable-5.1, neko/*");
 expect(matchesAllowedModels(patterns, "claude-fable-5.1")).toBe(true);
 expect(matchesAllowedModels(patterns, "CLAUDE-FABLE-5.1")).toBe(true);
 expect(matchesAllowedModels(patterns, "neko/deep-think")).toBe(true);
 expect(matchesAllowedModels(patterns, "other/deep-think")).toBe(false);
 expect(matchesAllowedModels(null, "anything")).toBe(true);
 expect(matchesAllowedModels(patterns, "")).toBe(false);
 });

 it("hides every model a restricted key would be refused", async () => {
 await ctx.editor.setStudioModel({
 callName: "only-me", displayName: "", targetModel: "ossnode/gpt-oss-120b",
 targetLabel: "ossnode/gpt-oss-120b", contextWindow: 0, systemPrompt: "",
 });
 await ctx.editor.setStudioModel({
 callName: "not-for-you", displayName: "", targetModel: "ossnode/gpt-oss-120b",
 targetLabel: "ossnode/gpt-oss-120b", contextWindow: 0, systemPrompt: "",
 });
 const { createApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
 const key = await createApiKey("restricted", "test-machine", { allowedModels: "only-me" });
 const { buildModelsList } = await import("@/app/api/v1/models/route.js");
 const request = new Request("http://router.test/v1/models", {
 headers: { authorization: `Bearer ${key.key}` },
 });
 const ids = (await buildModelsList(["llm"], { skipDynamicFetch: true, request })).map((m) => m.id);
 expect(ids).toEqual(["only-me"]);
 const openIds = (await buildModelsList(["llm"], { skipDynamicFetch: true })).map((m) => m.id);
 expect(openIds).toContain("only-me");
 expect(openIds).toContain("not-for-you");
 });
});
