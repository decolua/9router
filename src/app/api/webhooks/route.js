import { createWebhookDestination, listWebhookDestinations } from "@/lib/db/repos/webhooksRepo.js";
import { readWebhookMutation, webhookErrors, webhookException, webhookJson } from "@/lib/webhooks/api.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return webhookJson({ destinations: await listWebhookDestinations() });
  } catch (error) {
    return webhookException(error);
  }
}

export async function POST(request) {
  try {
    const result = await createWebhookDestination(await readWebhookMutation(request));
    return result.ok ? webhookJson(result, 201) : webhookErrors(result.errors);
  } catch (error) {
    return webhookException(error);
  }
}
