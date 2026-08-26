import { NextResponse } from "next/server";
import {
  deletePricingModel,
  getPricingModels,
  replacePricingMappings,
  setPricingMappings,
  updateSettings,
  upsertPricingModels,
} from "@/lib/localDb.js";
import { disableModels } from "@/lib/disabledModelsDb.js";
import { getPricingPageData } from "@/shared/services/pricingCatalog.js";

export const dynamic = "force-dynamic";

const RATE_FIELDS = ["input", "output", "cached", "cache_creation", "reasoning"];

function normalizePricing(value, source = "manual") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("定价格式无效");
  const pricing = {};
  for (const field of RATE_FIELDS) {
    const rate = Number(value[field] || 0);
    if (!Number.isFinite(rate) || rate < 0) throw new Error(`${field} 必须是非负数`);
    pricing[field] = rate;
  }
  pricing.peakEnabled = value.peakEnabled === true;
  pricing.peakWindows = String(value.peakWindows || "").trim();
  for (const tier of ["peakPricing", "offPeakPricing"]) {
    pricing[tier] = {};
    for (const field of RATE_FIELDS) {
      const rate = Number(value[tier]?.[field] ?? pricing[field]);
      if (!Number.isFinite(rate) || rate < 0) throw new Error(`${tier}.${field} 必须是非负数`);
      pricing[tier][field] = rate;
    }
  }
  if (pricing.peakEnabled && !pricing.peakWindows) throw new Error("启用峰谷定价时必须填写峰时时段");
  return { ...pricing, source };
}

async function requirePricingModel(model) {
  const pricingModels = await getPricingModels();
  if (!pricingModels[model]) throw new Error(`定价模型不存在：${model}`);
}

export async function GET() {
  try {
    return NextResponse.json(await getPricingPageData());
  } catch (error) {
    console.error("Error fetching pricing:", error);
    return NextResponse.json({ error: "加载模型定价失败" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const action = body?.action;

    if (action === "upsertPricing") {
      const model = String(body.model || "").trim();
      if (!model) return NextResponse.json({ error: "模型名称不能为空" }, { status: 400 });
      await upsertPricingModels({ [model]: normalizePricing(body.pricing) });
    } else if (action === "setDefault") {
      const model = String(body.model || "").trim();
      await requirePricingModel(model);
      await updateSettings({ defaultPricingModel: model });
    } else if (action === "setMappings") {
      const pricingModel = String(body.pricingModel || "").trim();
      await requirePricingModel(pricingModel);
      await replacePricingMappings(pricingModel, body.models);
    } else if (action === "mapModels") {
      const pricingModel = String(body.pricingModel || "").trim();
      await requirePricingModel(pricingModel);
      const mappings = (Array.isArray(body.models) ? body.models : []).map((item) => ({
        provider: item.provider,
        model: item.model,
        pricingModel,
      }));
      await setPricingMappings(mappings);
    } else if (action === "bulkMapSameName") {
      const overwrite = body.overwrite === true;
      const data = await getPricingPageData();
      const candidates = data.providerModels.filter((item) =>
        item.recommendedPricingModel && (overwrite || !item.mappedPricingModel),
      );
      await setPricingMappings(candidates.map((item) => ({
        provider: item.provider,
        model: item.model,
        pricingModel: item.recommendedPricingModel,
      })));
      return NextResponse.json({
        ...(await getPricingPageData()),
        result: {
          mappedCount: candidates.length,
          skippedCount: data.providerModels.length - candidates.length,
        },
      });
    } else if (action === "disableProviderModels") {
      const groups = new Map();
      for (const item of Array.isArray(body.models) ? body.models : []) {
        const provider = String(item?.provider || "").trim();
        const model = String(item?.model || "").trim();
        if (!provider || !model) continue;
        if (!groups.has(provider)) groups.set(provider, []);
        groups.get(provider).push(model);
      }
      if (!groups.size) return NextResponse.json({ error: "请选择要禁用的模型" }, { status: 400 });
      await Promise.all([...groups.entries()].map(([provider, ids]) => disableModels(provider, ids)));
    } else {
      return NextResponse.json({ error: "不支持的定价操作" }, { status: 400 });
    }

    return NextResponse.json(await getPricingPageData());
  } catch (error) {
    const message = error?.message || "保存模型定价失败";
    const status = /不存在|不能为空|必须|无效/.test(message) ? 400 : 500;
    console.error("Error updating pricing:", error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const model = String(searchParams.get("model") || "").trim();
    if (!model) return NextResponse.json({ error: "模型名称不能为空" }, { status: 400 });
    const data = await getPricingPageData();
    if (data.defaultPricingModel === model) {
      return NextResponse.json({ error: "默认定价模型不能删除，请先设置其他默认模型" }, { status: 409 });
    }
    await deletePricingModel(model);
    return NextResponse.json(await getPricingPageData());
  } catch (error) {
    console.error("Error deleting pricing:", error);
    return NextResponse.json({ error: error?.message || "删除模型定价失败" }, { status: 500 });
  }
}
