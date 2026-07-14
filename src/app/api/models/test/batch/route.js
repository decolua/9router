import { pingModelByKind } from "../ping";

const CONCURRENCY_LIMIT = 10;

export async function POST(request) {
  const body = await request.json();
  const { models } = body;

  if (!Array.isArray(models) || models.length === 0) {
    return Response.json({ error: "models array required" }, { status: 400 });
  }
  if (models.length > 200) {
    return Response.json({ error: "max 200 models per batch" }, { status: 400 });
  }
  for (const item of models) {
    if (!item || typeof item.model !== 'string' || !item.model.trim()) {
      return Response.json({ error: "each model must have a non-empty string 'model' field" }, { status: 400 });
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      if (request.signal.aborted) {
        controller.close();
        return;
      }
      try {
        const first = models[0];
        let warmupResult;
        try {
          warmupResult = await pingModelByKind(first.model, first.kind);
        } catch (err) {
          warmupResult = { ok: false, error: err.message, latencyMs: 0 };
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          model: first.model,
          kind: first.kind,
          ...warmupResult,
        })}\n\n`));

        const isProviderLevelError = warmupResult.error && (
          warmupResult.error.includes('401') ||
          warmupResult.error.includes('403') ||
          warmupResult.error.includes('timeout') ||
          warmupResult.error.includes('ECONNREFUSED') ||
          warmupResult.error.includes('ENOTFOUND')
        );

        if (isProviderLevelError) {
          for (const item of models.slice(1)) {
            if (request.signal.aborted) break;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              model: item.model,
              kind: item.kind,
              ok: false,
              error: "Skipped: provider unavailable",
              latencyMs: 0,
            })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();
          return;
        }

        const remaining = models.slice(1);
        for (let i = 0; i < remaining.length; i += CONCURRENCY_LIMIT) {
          if (request.signal.aborted) break;
          const batch = remaining.slice(i, i + CONCURRENCY_LIMIT);
          const batchPromises = batch.map(async (item) => {
            try {
              const result = await pingModelByKind(item.model, item.kind);
              const itemResult = { model: item.model, kind: item.kind, ...result };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(itemResult)}\n\n`));
              return itemResult;
            } catch (err) {
              const itemResult = { model: item.model, kind: item.kind, ok: false, error: err.message, latencyMs: 0 };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(itemResult)}\n\n`));
              return itemResult;
            }
          });

          await Promise.all(batchPromises);
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        controller.close();
      } catch (err) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        } catch {}
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
