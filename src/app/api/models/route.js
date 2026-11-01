import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias, getCustomModels } from "@/models";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { getSettings } from "@/lib/localDb";
import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias, ALIAS_TO_ID } from "@/shared/constants/providers";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { fetchSuggestedModelsServer, onlyFree } from "@/app/api/providers/suggested-models/filters.js";
import { FREE_PROVIDERS as FREE_PROVIDER_REGISTRY } from "@/shared/constants/providers.js";
import { resolveModelDisplayName } from "@/shared/utils/modelDisplayName";

// GET /api/models - Get models with aliases. Always dynamic: plugin badges
// (vision/thinkDeeper/jsonGuard/...) come from settings, which a prerendered
// response would freeze at whatever the settings were during the build.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const modelAliases = await getModelAliases();
    const disabled = await getDisabledModels();
    const settings = await getSettings().catch(() => ({}));
    const customPlugins = settings?.customPlugins || {};
    const atEnabled = Boolean(customPlugins.adaptiveThinking?.enabled);
    const atModels = new Set(customPlugins.adaptiveThinking?.models || []);
    const ivEnabled = Boolean(customPlugins.imageVision?.enabled);
    const ivModels = new Set(customPlugins.imageVision?.models || []);
    const tbEnabled = Boolean(customPlugins.openaiToolBridge?.enabled);
    const tbModels = new Set(customPlugins.openaiToolBridge?.models || []);

    // One resolver for every branch below.
    const PLUGIN_SOURCES = [
      ["adaptiveThinking", atEnabled, atModels, { reasoning: true, adaptiveThinking: true }],
      ["imageVision", ivEnabled, ivModels, { vision: true, imageVision: true }],
      // The bridge turns tools ON for an upstream that has no lane of its own, so
      // the listing has to say tools:true - a client reads the capability before
      // it ever sends a tools array.
      ["openaiToolBridge", tbEnabled, tbModels, { tools: true, openaiToolBridge: true }],
    ];

    /**
     * Turn on the plugins whose model list matches this entry and return the
     * keys that matched. `ids` is every shape the model may be listed under
     * (full model, routed model, the caller's own id).
     *
     * Image Vision sets BOTH caps.vision (vision-gated UI depends on it) and
     * caps.imageVision. Setting only caps.vision was the original bug: it is
     * indistinguishable from native vision, so the plugin drew no mark.
     */
    const applyPluginMarks = () => [];

    const models = AI_MODELS
      .filter((m) => {
        const alias = getProviderAlias(m.provider) || m.provider;
        const list = disabled[alias] || disabled[m.provider] || [];
        return !list.includes(m.model);
      })
      .map((m) => {
        const fullModel = `${m.provider}/${m.model}`;
        const providerAlias = getProviderAlias(m.provider) || m.provider;
        const routedModel = `${providerAlias}/${m.model}`;
        const c = getCapabilitiesForModel(m.provider, m.model);
        const caps = {
          vision: c.vision,
          search: c.search,
          reasoning: c.reasoning,
          contextWindow: c.contextWindow,
          maxOutput: c.maxOutput,
        };
        const pluginMarks = applyPluginMarks(caps, [fullModel, routedModel, m.model]);
        return {
          ...m,
          name: resolveModelDisplayName(m.model, m.name),
          fullModel,
          routedModel,
          alias: modelAliases[fullModel] || m.model,
          caps,
        pluginMarks,
        };
      });

    // Custom-model ids and live-catalogue ids both live in this set.
    const seenFull = new Set(models.map((m) => m.fullModel));
    const seenRouted = new Set(models.map((m) => m.routedModel));

    // Free no-auth providers publish a live catalogue (OpenCode Free moves weekly).
    // Registry entries above are curated, so anything upstream adds is merged in
    // here; without this the picker would only ever show what the build captured.
    const liveFree = await Promise.all(
      Object.entries(FREE_PROVIDER_REGISTRY)
        .filter(([, p]) => p.noAuth && !p.hidden && p.modelsFetcher)
        .map(async ([id, p]) => [p.alias || id, p.modelsFetcher, await fetchSuggestedModelsServer(p.modelsFetcher)])
    );
    const addedLive = [];
    for (const [alias, , liveModels] of liveFree) {
      for (const live of onlyFree(liveModels)) {
        const fullModel = `${alias}/${live.id}`;
        if (seenFull.has(fullModel)) continue;
        seenFull.add(fullModel);
        const c = getCapabilitiesForModel(alias, live.id);
        const caps = {
          vision: c.vision,
          search: c.search,
          reasoning: c.reasoning,
          contextWindow: c.contextWindow ?? live.contextLength,
          maxOutput: c.maxOutput,
        };
        const pluginMarks = applyPluginMarks(caps, [fullModel, live.id]);
        const entry = {
          provider: alias,
          model: live.id,
          name: live.name || live.id,
          fullModel,
          routedModel: fullModel,
          alias: modelAliases[fullModel] || live.id,
          caps,
        pluginMarks,
          liveSuggested: true,
        };
        models.push(entry);
        addedLive.push(entry);
      }
    }

    // Custom models ride along; their stored caps override the name heuristic.
    // A custom row whose provider alias routes to an already-listed model is a
    // pure shadow: the real entry wins (and is listed first), but this row would
    // land later with the same routedModel key and the client's last-write-wins
    // map then serves its thinner caps (a pre-registry "add custom model" row
    // stores {vision, reasoning} only — no contextWindow). Drop the shadow and
    // resolve the survivors' provider id, not the UI alias: the capability
    // tables are keyed by provider id, and an alias like `ocg` misses the
    // provider-scoped entries and falls back to the generic patterns.
    const customModels = (await getCustomModels()).filter((m) => {
      if (!m?.id || (m.kind || m.type || "llm") !== "llm") return false;
      if (seenRouted.has(`${m.providerAlias}/${m.id}`)) return false;
      return !seenFull.has(`${m.providerAlias}/${m.id}`);
    });
    for (const m of customModels) {
      const fullModel = `${m.providerAlias}/${m.id}`;
      const providerId = ALIAS_TO_ID[m.providerAlias] || m.providerAlias;
      const c = getCapabilitiesForModel(providerId, m.id);
      const caps = {
        vision: c.vision,
        search: c.search,
        reasoning: c.reasoning,
        contextWindow: c.contextWindow,
        maxOutput: c.maxOutput,
        ...(m.caps || {}),
      };
      const pluginMarks = applyPluginMarks(caps, [fullModel, m.id]);
      models.push({
        provider: m.providerAlias,
        model: m.id,
        name: m.name || m.id,
        fullModel,
        routedModel: fullModel,
        alias: modelAliases[fullModel] || m.id,
        caps,
        pluginMarks,
      });
    }

    // Studio (Custom Models) entries: the callable name is the key clients use,
    // so the plugin badge lookup must answer for the bare callName as well.
    const { getStudioModels } = await import("@/lib/db/repos/modelEditorRepo.js");
    let studioModels = [];
    try {
      studioModels = await getStudioModels();
    } catch {
      studioModels = [];
    }
    for (const s of studioModels) {
      const c = getCapabilitiesForModel(s.provider, s.model);
      const targetFull = `${s.provider}/${s.model}`;
      const caps = {
        vision: c.vision,
        search: c.search,
        reasoning: c.reasoning,
        contextWindow: c.contextWindow,
        maxOutput: c.maxOutput,
      };
      // A plugin applies when it names the studio name OR the model it calls.
      const names = [s.callName, targetFull, s.model];
      if (ivEnabled && names.some((n) => ivModels.has(n))) {
        caps.vision = true;
      }
      if (atEnabled && names.some((n) => atModels.has(n))) {
        caps.reasoning = true;
        caps.adaptiveThinking = true;
      }
      if (tbEnabled && names.some((n) => tbModels.has(n))) {
        caps.tools = true;
        caps.openaiToolBridge = true;
      }
      const pluginMarks = applyPluginMarks(caps, names);
      models.push({
        provider: s.provider,
        model: s.callName,
        name: s.displayName || s.callName,
        fullModel: `${s.provider}/${s.callName}`,
        routedModel: s.callName,
        alias: s.callName,
        caps,
        pluginMarks,
        isStudio: true,
      });
    }

    // Combos: aggregate the caps of their member models so a combo chip answers for
    // its badge and its window too. The same aggregator the public models list uses,
    // so a combo never reports a different window in two places.
    const { getCombos } = await import("@/lib/localDb");
    const { aggregateComboCapabilities } = await import("open-sse/providers/capabilities.js");
    let combos = [];
    try {
      combos = await getCombos();
    } catch {
      combos = [];
    }
    const comboByName = {};
    for (const combo of combos) {
      if (Array.isArray(combo.models) && combo.models.length) comboByName[combo.name] = combo.models;
    }
    for (const combo of combos) {
      const members = Array.isArray(combo.models) ? combo.models : [];
      if (members.length === 0) continue;
      const aggregated = aggregateComboCapabilities(members, comboByName, null, 0, Number(combo.contextWindow) || 0);
      if (!aggregated) continue;
      const comboCaps = { ...aggregated };
      // A combo's marks come from its members: the plugin selection was made per
      // model when the combo was configured, so those are the marks that apply.
      // The previous lookup wrote into an undefined `caps` and matched a stray
      // `m` from the outer loop, so a combo never showed a plugin mark.
      const comboMarks = new Set();
      for (const member of members) {
        for (const mark of applyPluginMarks(comboCaps, [member, String(member).split("/").pop()])) {
          comboMarks.add(mark);
        }
      }
      models.push({
        provider: "combo",
        model: combo.name,
        name: combo.name,
        fullModel: combo.name,
        routedModel: combo.name,
        alias: combo.name,
        caps: comboCaps,
        pluginMarks: [...comboMarks],
        isCombo: true,
      });
    }

    return NextResponse.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}

// PUT /api/models - Update model alias
export async function PUT(request) {
  try {
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    const modelAliases = await getModelAliases();

    // Check if alias already exists for different model
    const existingModel = Object.entries(modelAliases).find(
      ([key, val]) => val === alias && key !== model
    );

    if (existingModel) {
      return NextResponse.json({ error: "Alias already in use" }, { status: 400 });
    }

    // Update alias
    await setModelAlias(model, alias);

    return NextResponse.json({ success: true, model, alias });
  } catch (error) {
    console.log("Error updating alias:", error);
    return NextResponse.json({ error: "Failed to update alias" }, { status: 500 });
  }
}
