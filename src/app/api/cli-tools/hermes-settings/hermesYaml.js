// Pure text helpers for editing Hermes `config.yaml` / `.env` in place.
// Kept out of route.js so they are unit-testable (tests/unit/hermes-yaml.test.js).
//
// Hermes YAML shapes (see https://hermes-agent.nousresearch.com/docs/user-guide/configuration):
//   model:                      # top-level mapping block (children indented)
//     provider: "custom"
//     default: "provider/model"
//   model: ""                   # fresh install ships this scalar sentinel ("not configured")
//   delegation: { ... }         # top-level, subagent model
//   auxiliary: { <task>: { provider, model, base_url, api_key } }

// Top-level "model:" mapping block — key on its own line, indented children.
// NOTE: does NOT match the scalar sentinel `model: ""` (no newline right after `model:`).
export const MODEL_BLOCK_RE = /^model:[ \t]*\r?\n((?:[ \t]+.*\r?\n?|[ \t]*\r?\n)*)/m;
// Single-line form: `model: ""`, `model: ''`, `model:` at EOF. Anchored without indent so
// only the top-level key matches (`model_aliases:` never does — `:` must follow "model").
export const MODEL_SCALAR_RE = /^model:[ \t]*[^\r\n]*\r?\n?/m;
// Match top-level "delegation:" block (until next non-indented, non-empty line)
export const DELEGATION_BLOCK_RE = /^delegation:[ \t]*\r?\n((?:[ \t]+.*\r?\n?|[ \t]*\r?\n)*)/m;
// "auxiliary:" block; children are 2-space-indented role keys with 4+-space fields
export const AUX_BLOCK_RE = /^auxiliary:[ \t]*\r?\n((?:(?:[ \t]+.*\r?\n?)|(?:[ \t]*\r?\n))*)/m;
export const auxRoleRe = (role) => new RegExp(`^  ${role}:[ \\t]*\\r?\\n(?:(?:[ \\t]{4,}.*\\r?\\n?)|(?:[ \\t]*\\r?\\n))*`, "m");

export const buildModelBlock = (model, baseUrl) =>
  `model:\n  default: "${model}"\n  provider: "custom"\n  base_url: "${baseUrl}"\n  api_key: \${OPENAI_API_KEY}\n`;

export const buildDelegationBlock = (model, baseUrl) =>
  `delegation:\n  model: "${model}"\n  provider: "custom"\n  base_url: "${baseUrl}"\n  api_key: \${OPENAI_API_KEY}\n`;

export const buildAuxRoleBlock = (role, model, baseUrl) =>
  `  ${role}:\n    provider: "custom"\n    model: "${model}"\n    base_url: "${baseUrl}"\n    api_key: \${OPENAI_API_KEY}\n`;

const parseKeyValues = (body) => {
  const get = (key) => {
    const m = body.match(new RegExp(`^[ \\t]+${key}:[ \\t]*["']?([^"'\\r\\n]+)["']?`, "m"));
    return m ? m[1].trim() : null;
  };
  return get;
};

// Parse current model block back to fields (best-effort, simple key:value).
// Returns null when there is no mapping block — i.e. unset or the `model: ""` sentinel.
export const parseModelBlock = (yaml) => {
  const match = yaml.match(MODEL_BLOCK_RE);
  if (!match) return null;
  const get = parseKeyValues(match[1] || "");
  return {
    default: get("default"),
    provider: get("provider"),
    base_url: get("base_url"),
    api_key: get("api_key"),
  };
};

export const upsertModelBlock = (yaml, newBlock) => {
  if (MODEL_BLOCK_RE.test(yaml)) return yaml.replace(MODEL_BLOCK_RE, newBlock);
  // Scalar sentinel would otherwise survive the upsert and produce a duplicate `model:` key
  // (last-wins in most YAML loaders → the 9router block is silently ignored).
  if (MODEL_SCALAR_RE.test(yaml)) return yaml.replace(MODEL_SCALAR_RE, newBlock);
  return yaml.length > 0 ? `${newBlock}\n${yaml}` : newBlock;
};

export const upsertDelegationBlock = (yaml, newBlock) => {
  if (DELEGATION_BLOCK_RE.test(yaml)) return yaml.replace(DELEGATION_BLOCK_RE, newBlock);
  return yaml.endsWith("\n") || yaml.length === 0 ? `${yaml}${newBlock}` : `${yaml}\n${newBlock}`;
};

export const removeDelegationBlock = (yaml) => yaml.replace(DELEGATION_BLOCK_RE, "");

export const upsertAuxRole = (yaml, role, roleBlock) => {
  const re = auxRoleRe(role);
  const m = yaml.match(AUX_BLOCK_RE);
  if (!m) {
    const block = `auxiliary:\n${roleBlock}`;
    return yaml.endsWith("\n") || yaml.length === 0 ? `${yaml}${block}` : `${yaml}\n${block}`;
  }
  const body = re.test(m[1]) ? m[1].replace(re, roleBlock) : `${m[1]}${roleBlock}`;
  return yaml.replace(AUX_BLOCK_RE, `auxiliary:\n${body}`);
};

export const removeAuxRole = (yaml, role) => {
  const m = yaml.match(AUX_BLOCK_RE);
  if (!m) return yaml;
  const body = m[1].replace(auxRoleRe(role), "");
  if (body.trim() === "") return yaml.replace(AUX_BLOCK_RE, "");
  return yaml.replace(AUX_BLOCK_RE, `auxiliary:\n${body}`);
};

// role -> { model, provider, base_url } for every entry under "auxiliary:"
export const parseAuxRoles = (yaml) => {
  const m = yaml.match(AUX_BLOCK_RE);
  if (!m) return {};
  const roles = {};
  const subRe = /^  ([A-Za-z0-9_]+):[ \t]*\r?\n((?:(?:[ \t]{4,}.*\r?\n?)|(?:[ \t]*\r?\n))*)/gm;
  let sm;
  while ((sm = subRe.exec(m[1]))) {
    const get = parseKeyValues(sm[2]);
    roles[sm[1]] = { model: get("model"), provider: get("provider"), base_url: get("base_url") };
  }
  return roles;
};

export const parseDelegationBlock = (yaml) => {
  const match = yaml.match(DELEGATION_BLOCK_RE);
  if (!match) return null;
  const get = parseKeyValues(match[1] || "");
  return { model: get("model"), provider: get("provider"), base_url: get("base_url") };
};

export const removeModelBlock = (yaml) => {
  if (MODEL_BLOCK_RE.test(yaml)) return yaml.replace(MODEL_BLOCK_RE, "").replace(/^\n+/, "");
  if (MODEL_SCALAR_RE.test(yaml)) return yaml.replace(MODEL_SCALAR_RE, "").replace(/^\n+/, "");
  return yaml;
};

// .env helpers — upsert/remove single KEY=VALUE line
export const upsertEnvVar = (envText, key, value) => {
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  if (re.test(envText)) return envText.replace(re, line);
  return envText.length > 0 && !envText.endsWith("\n") ? `${envText}\n${line}\n` : `${envText}${line}\n`;
};

export const removeEnvVar = (envText, key) => {
  const re = new RegExp(`^${key}=.*\\r?\\n?`, "m");
  return envText.replace(re, "");
};

// Detect 9router by base_url containing localhost/127.0.0.1 or matching tunnel URL
export const has9RouterConfig = (modelCfg) => {
  if (!modelCfg?.base_url) return false;
  return modelCfg.provider === "custom" && /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(modelCfg.base_url);
};

// A block 9router wrote (provider "custom") regardless of endpoint — covers tunnel URLs,
// so reset/bulk logic can find them even when base_url is not localhost.
export const isCustomBlock = (cfg) => cfg?.provider === "custom";
