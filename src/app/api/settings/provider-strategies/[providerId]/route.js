import { NextResponse } from "next/server";

import { updateProviderStrategy } from "@/lib/localDb";
import { validateProviderAdmissionConfig } from "@/shared/config/providerAdmission.js";
import { resolveProviderId } from "@/shared/constants/providers.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_FIELDS = new Set([
  "fallbackStrategy",
  "stickyRoundRobinLimit",
  "admission",
]);
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const UNSAFE_PROVIDER_IDS = new Set(["__proto__", "constructor", "prototype"]);
const FALLBACK_STRATEGIES = new Set(["fill-first", "round-robin"]);

function validationError(error, errors = []) {
  return NextResponse.json({ error, errors }, { status: 400 });
}

export async function PATCH(request, { params }) {
  try {
    const { providerId: rawProviderId } = await params;
    const providerId = resolveProviderId(rawProviderId);
    if (
      typeof providerId !== "string" ||
      !PROVIDER_ID_PATTERN.test(providerId) ||
      UNSAFE_PROVIDER_IDS.has(providerId)
    ) {
      return validationError("Invalid provider ID");
    }

    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return validationError("Provider strategy patch must be an object");
    }

    const unknownFields = Object.keys(body).filter((key) => !ALLOWED_FIELDS.has(key));
    if (unknownFields.length > 0) {
      return validationError(
        `Unknown provider strategy field: ${unknownFields[0]}`,
        unknownFields.map((field) => ({
          field,
          code: "unknown_field",
          message: `Unknown provider strategy field: ${field}`,
        })),
      );
    }

    const patch = {};
    if (Object.prototype.hasOwnProperty.call(body, "fallbackStrategy")) {
      if (
        body.fallbackStrategy !== null &&
        !FALLBACK_STRATEGIES.has(body.fallbackStrategy)
      ) {
        return validationError("fallbackStrategy must be fill-first, round-robin, or null");
      }
      patch.fallbackStrategy = body.fallbackStrategy;
    }

    if (Object.prototype.hasOwnProperty.call(body, "stickyRoundRobinLimit")) {
      if (
        body.stickyRoundRobinLimit !== null &&
        (
          !Number.isInteger(body.stickyRoundRobinLimit) ||
          body.stickyRoundRobinLimit < 1 ||
          body.stickyRoundRobinLimit > 100
        )
      ) {
        return validationError("stickyRoundRobinLimit must be an integer between 1 and 100");
      }
      patch.stickyRoundRobinLimit = body.stickyRoundRobinLimit;
    }

    if (Object.prototype.hasOwnProperty.call(body, "admission")) {
      if (body.admission === null) {
        patch.admission = null;
      } else {
        const result = validateProviderAdmissionConfig(body.admission);
        if (!result.ok) {
          return validationError(result.errors[0].message, result.errors);
        }
        patch.admission = result.value;
      }
    }

    if (Object.keys(patch).length === 0) {
      return validationError("At least one provider strategy field is required");
    }

    const strategy = await updateProviderStrategy(providerId, patch);
    return NextResponse.json(
      { providerId, strategy },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.log("Error updating provider strategy:", error);
    return NextResponse.json(
      { error: "Failed to update provider strategy" },
      { status: 500 },
    );
  }
}
