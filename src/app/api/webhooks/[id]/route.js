import { deleteWebhookDestination, updateWebhookDestination } from "@/lib/db/repos/webhooksRepo.js";
import { abortWebhookDestination } from "@/lib/webhooks/dispatcher.js";
import { readWebhookMutation, webhookErrors, webhookException, webhookJson, webhookRevisionInput } from "@/lib/webhooks/api.js";

export const dynamic = "force-dynamic";

function abortRevokedDestination(id) {
  try { abortWebhookDestination(id); } catch { /* Transactional revocation is authoritative. */ }
}

export async function PATCH(request, context) {
  try {
    const { patch, options } = webhookRevisionInput(await readWebhookMutation(request));
    const { id } = await context.params;
    const result = await updateWebhookDestination(id, patch, options);
    if (!result.ok) return webhookErrors(result.errors);
    if (["url", "kind", "headers", "signingSecret", "allowPrivateNetwork"].some((key) => Object.hasOwn(patch, key))
      || patch.enabled === false || patch.clearHeaders === true || patch.clearSigningSecret === true) {
      abortRevokedDestination(id);
    }
    return webhookJson(result);
  } catch (error) {
    return webhookException(error);
  }
}

export async function DELETE(request, context) {
  try {
    const { options } = webhookRevisionInput(await readWebhookMutation(request, { allowEmpty: true }), { revisionOnly: true });
    const { id } = await context.params;
    const result = await deleteWebhookDestination(id, options);
    if (!result.ok) return webhookErrors(result.errors);
    abortRevokedDestination(id);
    return webhookJson(result);
  } catch (error) {
    return webhookException(error);
  }
}
