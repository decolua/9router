import { getWebhookQueueHealth, listWebhookDeliveries } from "@/lib/db/repos/webhookDeliveriesRepo.js";
import { getWebhookDegradation } from "@/lib/webhooks/dispatcher.js";
import { webhookDeliveryQuery, webhookException, webhookJson } from "@/lib/webhooks/api.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const deliveries = await listWebhookDeliveries(webhookDeliveryQuery(request));
    const queue = await getWebhookQueueHealth();
    return webhookJson({ deliveries, health: { queue, degraded: getWebhookDegradation() } });
  } catch (error) {
    return webhookException(error);
  }
}
