/**
 * Model Pattern Matcher
 * Validates if a model matches any pattern in an allowlist
 */

/**
 * Normalize model string to provider/model format
 * @param {string} model - Model string (may be alias or full format)
 * @returns {string} Normalized format "provider/model"
 */
function normalizeModel(model) {
  if (!model || typeof model !== 'string') {
    return '';
  }

  // Already in provider/model format
  if (model.includes('/')) {
    return model.toLowerCase().trim();
  }

  // Handle edge cases (single word = assume it's a model name)
  return model.toLowerCase().trim();
}

/**
 * Check if model matches a single pattern
 * @param {string} model - Normalized model (provider/model)
 * @param {string} pattern - Pattern to match against
 * @returns {boolean} True if matches
 */
function matchesPattern(model, pattern) {
  if (!model || !pattern) return false;

  const normalizedPattern = pattern.toLowerCase().trim();
  const normalizedModel = model.toLowerCase().trim();

  // Exact match
  if (normalizedPattern === normalizedModel) {
    return true;
  }

  // Provider wildcard (e.g., "gh/*")
  if (normalizedPattern.endsWith('/*')) {
    const provider = normalizedPattern.slice(0, -2);
    const modelProvider = normalizedModel.split('/')[0];
    return provider === modelProvider;
  }

  // Global wildcard
  if (normalizedPattern === '*') {
    return true;
  }

  return false;
}

/**
 * Check if model is allowed by any pattern in allowlist
 * @param {string} model - Model to check
 * @param {string[]} allowedModels - Array of allowed patterns
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function isModelAllowed(model, allowedModels) {
  // Empty or missing allowlist = unrestricted
  if (!allowedModels || !Array.isArray(allowedModels) || allowedModels.length === 0) {
    return { allowed: true };
  }

  const normalizedModel = normalizeModel(model);

  if (!normalizedModel) {
    return {
      allowed: false,
      reason: 'Invalid model format'
    };
  }

  // Check each pattern
  for (const pattern of allowedModels) {
    if (matchesPattern(normalizedModel, pattern)) {
      return { allowed: true };
    }
  }

  // No matches found
  return {
    allowed: false,
    reason: `Model '${model}' not allowed. Allowed patterns: ${allowedModels.join(', ')}`
  };
}

/**
 * Validate allowedModels array format
 * @param {any} allowedModels - Value to validate
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateAllowedModelsFormat(allowedModels) {
  // Empty/null is valid (unrestricted)
  if (!allowedModels) {
    return { valid: true };
  }

  // Must be array
  if (!Array.isArray(allowedModels)) {
    return {
      valid: false,
      error: 'allowedModels must be an array'
    };
  }

  // Check each element is a string
  for (let i = 0; i < allowedModels.length; i++) {
    const pattern = allowedModels[i];

    if (typeof pattern !== 'string') {
      return {
        valid: false,
        error: `Pattern at index ${i} must be a string`
      };
    }

    if (pattern.trim().length === 0) {
      return {
        valid: false,
        error: `Pattern at index ${i} cannot be empty`
      };
    }

    // Basic format validation (optional, can be extended)
    const normalized = pattern.toLowerCase().trim();

    // Check for invalid characters (allow alphanumeric, /, -, _, ., *)
    if (!/^[\w\-\.\/\*]+$/.test(normalized)) {
      return {
        valid: false,
        error: `Pattern '${pattern}' contains invalid characters`
      };
    }
  }

  return { valid: true };
}
