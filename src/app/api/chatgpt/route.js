import { getSettings, updateSettings } from "@/lib/localDb";
import { buildModelsList } from "@/app/api/v1/models/route";
import { MAX_CHATGPT_MODELS, selectedModels, selectChatGPTModels } from "@/lib/chatgpt/models";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const [settings, available, searchModels] = await Promise.all([
      getSettings(), buildModelsList(["llm"]), buildModelsList(["webSearch"]),
    ]);
    return Response.json({
      models: selectedModels(settings), available, searchModels,
      webSearchModel: settings.chatgptIntegration?.webSearchModel || "",
      limit: MAX_CHATGPT_MODELS,
    }, { headers });
  } catch {
    return Response.json({ error: "Could not load ChatGPT integration models." }, { status: 500, headers });
  }
}

export async function PUT(request) {
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers }); }
  try {
    const [available, searchModels] = await Promise.all([buildModelsList(["llm"]), buildModelsList(["webSearch"])]);
    let models;
    try { models = selectChatGPTModels(body?.models, available); }
    catch (error) { return Response.json({ error: error.message }, { status: 400, headers }); }
    let webSearchModel = body?.webSearchModel;
    if (webSearchModel === undefined || webSearchModel === null || webSearchModel === "") webSearchModel = "";
    else if (typeof webSearchModel !== "string" || !searchModels.some(model => model?.kind === "webSearch" && model.id === webSearchModel)) {
      return Response.json({ error: "This model is not an active web-search provider." }, { status: 400, headers });
    }
    await updateSettings({ chatgptIntegration: { models, webSearchModel } });
    return Response.json({ models, webSearchModel }, { headers });
  } catch {
    return Response.json({ error: "Could not save ChatGPT integration models." }, { status: 500, headers });
  }
}
