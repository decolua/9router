export const PROVIDER_ADMISSION_DEFAULTS = Object.freeze({
  enabled: false,
  maxInFlightPerAccount: 1,
  maxQueueSize: 200,
  queueTimeoutMs: 30000,
});

export const PROVIDER_ADMISSION_LIMITS = Object.freeze({
  maxInFlightPerAccount: Object.freeze({ min: 1, max: 100 }),
  maxQueueSize: Object.freeze({ min: 0, max: 5000 }),
  queueTimeoutMs: Object.freeze({ min: 100, max: 300000 }),
});

const ADMISSION_FIELDS = new Set([
  "enabled",
  "maxInFlightPerAccount",
  "maxQueueSize",
  "queueTimeoutMs",
]);

function fieldError(field, code, message) {
  return { field, code, message };
}

function validateIntegerField(input, field, errors) {
  if (!Object.prototype.hasOwnProperty.call(input, field)) return;

  const value = input[field];
  const limits = PROVIDER_ADMISSION_LIMITS[field];
  if (!Number.isInteger(value)) {
    errors.push(fieldError(field, "invalid_integer", `${field} must be an integer`));
    return;
  }
  if (value < limits.min || value > limits.max) {
    errors.push(fieldError(
      field,
      "out_of_range",
      `${field} must be between ${limits.min} and ${limits.max}`,
    ));
  }
}

export function validateProviderAdmissionConfig(input, { partial = false } = {}) {
  if (input === undefined || input === null) {
    return {
      ok: true,
      value: partial ? {} : { ...PROVIDER_ADMISSION_DEFAULTS },
      errors: [],
      missing: true,
    };
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      value: null,
      errors: [fieldError("admission", "invalid_object", "admission must be an object")],
      missing: false,
    };
  }

  const errors = [];
  for (const key of Object.keys(input)) {
    if (!ADMISSION_FIELDS.has(key)) {
      errors.push(fieldError(key, "unknown_field", `Unknown admission field: ${key}`));
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(input, "enabled") &&
    typeof input.enabled !== "boolean"
  ) {
    errors.push(fieldError("enabled", "invalid_boolean", "enabled must be a boolean"));
  }

  validateIntegerField(input, "maxInFlightPerAccount", errors);
  validateIntegerField(input, "maxQueueSize", errors);
  validateIntegerField(input, "queueTimeoutMs", errors);

  if (errors.length > 0) {
    return { ok: false, value: null, errors, missing: false };
  }

  return {
    ok: true,
    value: partial
      ? { ...input }
      : { ...PROVIDER_ADMISSION_DEFAULTS, ...input },
    errors: [],
    missing: false,
  };
}

export class ProviderAdmissionConfigError extends Error {
  constructor(errors) {
    super(errors?.[0]?.message || "Invalid provider admission configuration");
    this.name = "ProviderAdmissionConfigError";
    this.errors = errors || [];
  }
}

export function resolveProviderAdmissionConfig(input) {
  const result = validateProviderAdmissionConfig(input);
  if (!result.ok) throw new ProviderAdmissionConfigError(result.errors);
  return result.value;
}
