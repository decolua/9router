// Gemini helper functions for translator

// Unsupported JSON Schema constraints that should be removed for Antigravity
export const UNSUPPORTED_SCHEMA_CONSTRAINTS = [
  "minLength", "maxLength", "exclusiveMinimum", "exclusiveMaximum",
  "pattern", "minItems", "maxItems", "format",
  "default", "examples", "$schema", "const"
];

// Default safety settings
export const DEFAULT_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "OFF" }
];

// Convert OpenAI content to Gemini parts
export function convertOpenAIContentToParts(content) {
  const parts = [];
  
  if (typeof content === "string") {
    parts.push({ text: content });
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === "text") {
        parts.push({ text: item.text });
      } else if (item.type === "image_url" && item.image_url?.url?.startsWith("data:")) {
        const url = item.image_url.url;
        const commaIndex = url.indexOf(",");
        if (commaIndex !== -1) {
          const mimePart = url.substring(5, commaIndex); // skip "data:"
          const data = url.substring(commaIndex + 1);
          const mimeType = mimePart.split(";")[0];

          parts.push({
            inlineData: { mime_type: mimeType, data: data }
          });
        }
      }
    }
  }
  
  return parts;
}

// Extract text content from OpenAI content
export function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter(c => c.type === "text").map(c => c.text).join("");
  }
  return "";
}

// Try parse JSON safely
export function tryParseJSON(str) {
  if (typeof str !== "string") return str;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// Generate request ID
export function generateRequestId() {
  return `agent-${crypto.randomUUID()}`;
}

// Generate session ID
export function generateSessionId() {
  return `-${Math.floor(Math.random() * 9000000000000000000)}`;
}

// Generate project ID
export function generateProjectId() {
  const adjectives = ["useful", "bright", "swift", "calm", "bold"];
  const nouns = ["fuze", "wave", "spark", "flow", "core"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}-${crypto.randomUUID().slice(0, 5)}`;
}

// Clean JSON Schema for Antigravity API compatibility - removes unsupported keywords recursively
export function cleanJSONSchemaForAntigravity(schema) {
  if (!schema || typeof schema !== "object") return schema;
  
  const cleaned = Array.isArray(schema) ? [] : {};
  
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_SCHEMA_CONSTRAINTS.includes(key)) continue;
    
    // Handle type array like ["string", "null"] - Gemini only supports single type
    if (key === "type" && Array.isArray(value)) {
      const nonNullType = value.find(t => t !== "null") || "string";
      cleaned[key] = nonNullType;
      continue;
    }
    
    if (value && typeof value === "object") {
      cleaned[key] = cleanJSONSchemaForAntigravity(value);
    } else {
      cleaned[key] = value;
    }
  }
  
  // Cleanup required fields - only keep fields that exist in properties
  if (cleaned.required && Array.isArray(cleaned.required) && cleaned.properties) {
    const validRequired = cleaned.required.filter(field => 
      Object.prototype.hasOwnProperty.call(cleaned.properties, field)
    );
    if (validRequired.length === 0) {
      delete cleaned.required;
    } else {
      cleaned.required = validRequired;
    }
  }
  
  // Add placeholder for empty object schemas (Antigravity requirement)
  if (cleaned.type === "object") {
    if (!cleaned.properties || Object.keys(cleaned.properties).length === 0) {
      cleaned.properties = {
        reason: {
          type: "string",
          description: "Brief explanation of why you are calling this tool"
        }
      };
      cleaned.required = ["reason"];
    }
  }
  
  return cleaned;
}

