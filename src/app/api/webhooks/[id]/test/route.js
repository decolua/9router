import { enqueueWebhookTest } from "@/lib/db/repos/webhookDeliveriesRepo.js";
import { recordWebhookEnqueueFailure } from "@/lib/webhooks/dispatcher.js";
import { checkWebhookTestInput, readWebhookMutation, webhookErrors, webhookException, webhookJson } from "@/lib/webhooks/api.js";

export const dynamic = "force-dynamic";

export async function POST(request, context) {
  try {
    checkWebhookTestInput(request, await readWebhookMutation(request));
    const { id } = await context.params;
    let result;
    try {
      result = await enqueueWebhookTest(id);
    } catch {
      recordWebhookEnqueueFailure("storage_error");
      return webhookErrors([{ field: "outbox", code: "storage_error" }]);
    }
    if (!result.ok) {
      if (result.errors.some(({ code }) => code !== "not_found")) recordWebhookEnqueueFailure(result.errors[0]?.code);
      return webhookErrors(result.errors);
    }
    return webhookJson({ ok: true, deliveryId: result.deliveryIds[0] }, 202);
  } catch (error) {
    return webhookException(error);
  }
}
