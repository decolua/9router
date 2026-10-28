import { CUSTOM_JSON_DEFAULTS } from "open-sse/config/customJson.js";
import { normalizeCustomJsonConfig } from "open-sse/utils/customJson.js";

export function customJsonForm(config = CUSTOM_JSON_DEFAULTS) {
  const template = config.requestTemplate || CUSTOM_JSON_DEFAULTS.requestTemplate;
  const usesDefaultFields = Object.entries(CUSTOM_JSON_DEFAULTS.requestTemplate).every(([name, value]) => template[name] === value);
  return {
    ...CUSTOM_JSON_DEFAULTS, ...config,
    templateMode: usesDefaultFields ? "fields" : "json",
    extraFields: Object.entries(template)
      .filter(([name]) => !Object.hasOwn(CUSTOM_JSON_DEFAULTS.requestTemplate, name))
      .map(([name, value], index) => ({
        id: `saved-${index}`, name,
        type: typeof value === "string" ? "text" : "json",
        value: typeof value === "string" ? value : JSON.stringify(value),
      })),
    requestTemplateText: JSON.stringify(template, null, 2),
    headersText: JSON.stringify(config.headers || {}, null, 2),
  };
}

export function buildCustomJsonTemplate(fields = []) {
  const entries = Object.entries(CUSTOM_JSON_DEFAULTS.requestTemplate);
  const names = new Set(entries.map(([name]) => name));
  for (const field of fields) {
    const name = field.name.trim();
    // Adding an untouched row is optional and does not block saving.
    if (!name && !field.value.trim()) continue;
    if (!name) throw new Error("Enter a name for the extra field, or remove the row");
    if (names.has(name)) throw new Error(`Duplicate field name: ${name}`);
    let value = field.value;
    if (field.type === "json") {
      try { value = JSON.parse(value); }
      catch { throw new Error(`Field ${name} must contain valid JSON`); }
    }
    names.add(name);
    entries.push([name, value]);
  }
  return Object.fromEntries(entries);
}

export function parseCustomJsonForm(form, endpoint) {
  let requestTemplate, headers;
  if (form.templateMode === "fields") {
    requestTemplate = buildCustomJsonTemplate(form.extraFields);
  } else {
    try { requestTemplate = JSON.parse(form.requestTemplateText); }
    catch { throw new Error("Request template must be valid JSON"); }
  }
  try { headers = JSON.parse(form.headersText); }
  catch { throw new Error("Custom headers must be valid JSON"); }
  return normalizeCustomJsonConfig({ ...form, requestTemplate, headers }, endpoint);
}
