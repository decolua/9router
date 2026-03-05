/**
 * Response sanitization utility to prevent sensitive data leaks
 * Removes or masks sensitive fields from API responses
 */

/**
 * Fields that should be completely removed from responses
 */
const SENSITIVE_FIELDS = [
  'apiKey',
  'key',
  'accessToken',
  'refreshToken',
  'token',
  'idToken',
  'credentials',
  'secret',
  'password',
  'clientSecret',
];

/**
 * Mask an email address (show first char + *** + domain)
 * Example: user@example.com -> u***@example.com
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return email;
  if (!email.includes('@')) return email;
  
  const [local, domain] = email.split('@');
  if (local.length === 0) return email;
  
  return `${local[0]}***@${domain}`;
}

/**
 * Mask an API key (show first 8 chars + ***)
 * Example: sk_1234567890abcdef -> sk_12345***
 */
function maskApiKey(key) {
  if (!key || typeof key !== 'string') return key;
  if (key.length <= 8) return '***';
  
  return `${key.substring(0, 8)}***`;
}

/**
 * Recursively sanitize an object by removing sensitive fields
 * @param {any} data - Data to sanitize (object, array, or primitive)
 * @param {object} options - Sanitization options
 * @param {boolean} options.maskEmails - Whether to mask email addresses in accountName fields
 * @param {boolean} options.maskApiKeys - Whether to mask API keys instead of removing them
 * @param {string[]} options.additionalFields - Additional field names to remove
 * @returns {any} Sanitized data
 */
export function sanitizeResponse(data, options = {}) {
  const {
    maskEmails = true,
    maskApiKeys = false,
    additionalFields = [],
  } = options;

  const fieldsToRemove = [...SENSITIVE_FIELDS, ...additionalFields];

  function sanitize(obj) {
    // Handle null/undefined
    if (obj === null || obj === undefined) {
      return obj;
    }

    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map(item => sanitize(item));
    }

    // Handle non-objects (primitives)
    if (typeof obj !== 'object') {
      return obj;
    }

    // Handle objects
    const sanitized = {};

    for (const [key, value] of Object.entries(obj)) {
      // Remove sensitive fields
      if (fieldsToRemove.includes(key)) {
        if (maskApiKeys && (key === 'apiKey' || key === 'key')) {
          sanitized[key] = maskApiKey(value);
        }
        // Otherwise skip (remove) the field
        continue;
      }

      // Mask email addresses in accountName fields
      if (maskEmails && key === 'accountName' && typeof value === 'string' && value.includes('@')) {
        sanitized[key] = maskEmail(value);
      }
      // Mask email field itself
      else if (maskEmails && key === 'email' && typeof value === 'string') {
        sanitized[key] = maskEmail(value);
      }
      // Recursively sanitize nested objects/arrays
      else if (value !== null && typeof value === 'object') {
        sanitized[key] = sanitize(value);
      }
      // Keep primitive values as-is
      else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  return sanitize(data);
}

/**
 * Sanitize usage stats response specifically
 * Removes full API keys from byApiKey section and masks account emails
 */
export function sanitizeUsageStats(stats) {
  if (!stats || typeof stats !== 'object') return stats;

  const sanitized = { ...stats };

  // Remove or mask byApiKey entries
  if (sanitized.byApiKey && typeof sanitized.byApiKey === 'object') {
    const sanitizedByApiKey = {};
    
    for (const [key, value] of Object.entries(sanitized.byApiKey)) {
      // Mask the API key in the entry
      const sanitizedEntry = { ...value };
      if (sanitizedEntry.apiKey) {
        sanitizedEntry.apiKey = maskApiKey(sanitizedEntry.apiKey);
      }
      if (sanitizedEntry.apiKeyKey) {
        sanitizedEntry.apiKeyKey = maskApiKey(sanitizedEntry.apiKeyKey);
      }
      
      // Use masked key as the new key
      const maskedKey = key.includes('|') 
        ? key.split('|').map((part, i) => i === 0 ? maskApiKey(part) : part).join('|')
        : maskApiKey(key);
      
      sanitizedByApiKey[maskedKey] = sanitizedEntry;
    }
    
    sanitized.byApiKey = sanitizedByApiKey;
  }

  // Mask emails in byAccount
  if (sanitized.byAccount && typeof sanitized.byAccount === 'object') {
    const sanitizedByAccount = {};
    
    for (const [key, value] of Object.entries(sanitized.byAccount)) {
      const sanitizedEntry = { ...value };
      if (sanitizedEntry.accountName && sanitizedEntry.accountName.includes('@')) {
        sanitizedEntry.accountName = maskEmail(sanitizedEntry.accountName);
      }
      sanitizedByAccount[key] = sanitizedEntry;
    }
    
    sanitized.byAccount = sanitizedByAccount;
  }

  // Mask emails in activeRequests
  if (Array.isArray(sanitized.activeRequests)) {
    sanitized.activeRequests = sanitized.activeRequests.map(req => {
      const sanitizedReq = { ...req };
      if (sanitizedReq.account && sanitizedReq.account.includes('@')) {
        sanitizedReq.account = maskEmail(sanitizedReq.account);
      }
      return sanitizedReq;
    });
  }

  return sanitized;
}

/**
 * Sanitize provider connection data
 * Removes tokens and credentials
 */
export function sanitizeProviderConnection(connection) {
  return sanitizeResponse(connection, {
    maskEmails: true,
    maskApiKeys: false,
    additionalFields: ['code', 'codeVerifier', 'state'],
  });
}

/**
 * Sanitize API key data
 * Masks the actual key value
 */
export function sanitizeApiKeyData(keyData) {
  if (!keyData) return keyData;
  
  if (Array.isArray(keyData)) {
    return keyData.map(k => ({
      ...k,
      key: maskApiKey(k.key),
    }));
  }
  
  return {
    ...keyData,
    key: maskApiKey(keyData.key),
  };
}
