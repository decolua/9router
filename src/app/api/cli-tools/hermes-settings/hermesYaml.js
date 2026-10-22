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

// ── stt: audio transcription via 9router ─────────────────────────────────────────────
// Hermes runs voice messages / audio attachments through `stt.provider`; the "openai"
// backend is OpenAI-SDK-shaped and honours stt.openai.base_url + stt.openai.api_key as
// endpoint overrides (tools/transcription_cloud.py `_direct_openai_credentials`), and
// load_config() expands the ${OPENAI_API_KEY} reference from the profile's .env. Pointing
// it at 9router's /v1/audio/transcriptions routes every transcription through the proxy:
//
//   stt:
//     enabled: true
//     provider: "openai"
//     openai:
//       model: "groq/whisper-large-v3"   # provider-qualified — 9router routes on it
//       base_url: "http://127.0.0.1:20128/v1"
//       api_key: ${OPENAI_API_KEY}

// Top-level "stt:" block — same capture shape as delegation. Children are 2-space
// indented; the "openai" sub-block carries 4-space fields.
export const STT_BLOCK_RE = /^stt:[ \t]*\r?\n((?:[ \t]+.*\r?\n?|[ \t]*\r?\n)*)/m;
const sttSubRe = (name) =>
  new RegExp(`^  ${name}:[ \\t]*\\r?\\n((?:(?:[ \\t]{4,}.*\\r?\\n?)|(?:[ \\t]*\\r?\\n))*)`, "m");
const STT_API_KEY_REF = "${OPENAI_API_KEY}";
const stripYamlQuotes = (value) => value.replace(/^[ \t]*["']|["'][ \t]*$/g, "").trim();

// Current stt wiring back to fields (best-effort, simple key:value). Returns null when
// there is no top-level stt block. `model`/`base_url`/`api_key` read the "openai" sub-block
// — the backend our override targets; sibling settings (language, local, ...) are ignored.
export const parseSttBlock = (yaml) => {
  const match = yaml.match(STT_BLOCK_RE);
  if (!match) return null;
  const lines = (match[1] || "").split(/\r?\n/);
  const direct = {};
  const openai = {};
  let current = null;
  for (const line of lines) {
    if (/^  \S/.test(line)) {
      const kv = line.match(/^  ([A-Za-z0-9_]+):[ \t]*(.*)$/);
      current = null;
      if (kv && kv[2] !== "") direct[kv[1]] = stripYamlQuotes(kv[2]);
      else if (kv) current = kv[1]; // valueless key = sub-block head
    } else if (current === "openai" && /^ {4,}\S/.test(line)) {
      const kv = line.match(/^ {4,}([A-Za-z0-9_]+):[ \t]*(.*)$/);
      if (kv && kv[2] !== "") openai[kv[1]] = stripYamlQuotes(kv[2]);
    }
  }
  return {
    enabled: direct.enabled ?? null,
    provider: direct.provider ?? null,
    model: openai.model ?? null,
    base_url: openai.base_url ?? null,
    api_key: openai.api_key ?? null,
  };
};

// The stt wiring this card wrote: openai backend + the profile key reference. The api_key
// reference is the fingerprint — a user's own OpenAI audio setup keeps their own key (or
// none), while ours always points at the OPENAI_API_KEY line we upsert in .env. base_url
// may be a tunnel URL, so no localhost test here (same reasoning as isCustomBlock).
export const is9RouterStt = (cfg) =>
  cfg?.provider === "openai" && !!cfg?.base_url && cfg?.api_key === STT_API_KEY_REF;

export const buildSttBlock = (model, baseUrl) =>
  `stt:\n  enabled: true\n  provider: "openai"\n  openai:\n    model: "${model}"\n    base_url: "${baseUrl}"\n    api_key: ${STT_API_KEY_REF}\n`;

// Replace-or-append one `  key: value` direct child of the stt block body.
const upsertSttDirect = (body, key, value) => {
  const re = new RegExp(`^  ${key}:[^\\r\\n]*`, "m");
  if (re.test(body)) return body.replace(re, `  ${key}: ${value}`);
  const head = `  ${key}: ${value}\n`;
  return body.length > 0 && !body.endsWith("\n") ? `${body}\n${head}` : `${body}${head}`;
};

// Replace-or-append `    key: value` inside the stt "openai" sub-block; creates the
// sub-block when absent. Scoped to the sub-block so sibling sections (stt.local.model)
// can never be touched by the replace.
const upsertSttOpenai = (body, key, value) => {
  const sub = body.match(sttSubRe("openai"));
  if (!sub) {
    const block = `  openai:\n    ${key}: ${value}\n`;
    return body.length > 0 && !body.endsWith("\n") ? `${body}\n${block}` : `${body}${block}`;
  }
  const re = new RegExp(`^ {4}${key}:[^\\r\\n]*`, "m");
  const subBody = re.test(sub[1])
    ? sub[1].replace(re, `    ${key}: ${value}`)
    : sub[1].endsWith("\n") || sub[1].length === 0
      ? `${sub[1]}    ${key}: ${value}\n`
      : `${sub[1]}\n    ${key}: ${value}\n`;
  return body.replace(sttSubRe("openai"), `  openai:\n${subBody}`);
};

// Write the 9router STT wiring, preserving every sibling setting the user already has
// (language, local model, echo_transcripts, ...). Upserts the openai backend keys only.
export const upsertStt9Router = (yaml, model, baseUrl) => {
  let body = yaml.match(STT_BLOCK_RE)?.[1] ?? null;
  if (body === null) {
    const prefix = yaml.length === 0 ? "" : yaml.endsWith("\n") ? yaml : `${yaml}\n`;
    return `${prefix}${buildSttBlock(model, baseUrl)}`;
  }
  body = upsertSttDirect(body, "enabled", "true");
  body = upsertSttDirect(body, "provider", `"openai"`);
  body = upsertSttOpenai(body, "model", `"${model}"`);
  body = upsertSttOpenai(body, "base_url", `"${baseUrl}"`);
  body = upsertSttOpenai(body, "api_key", STT_API_KEY_REF);
  return yaml.replace(STT_BLOCK_RE, `stt:\n${body}`);
};

// Drop only the keys the wiring above writes — enabled (only when true, the default),
// provider (only when "openai") and the openai model/base_url/api_key trio. Anything the
// user owns (language, local, an explicit provider choice) survives. Returns to Hermes'
// STT autodetect ladder rather than remembering a pre-existing provider: the original
// api_key line was already replaced by the upsert, so there is nothing to restore.
export const removeStt9Router = (yaml) => {
  const match = yaml.match(STT_BLOCK_RE);
  if (!match) return yaml;
  let body = match[1] || "";
  body = body.replace(/^  enabled:[ \t]*["']?true["']?[ \t]*\r?\n?/m, "");
  body = body.replace(/^  provider:[ \t]*["']?openai["']?[ \t]*\r?\n?/m, "");
  const sub = body.match(sttSubRe("openai"));
  if (sub) {
    let subBody = sub[1] || "";
    for (const key of ["model", "base_url", "api_key"]) {
      subBody = subBody.replace(new RegExp(`^ {4}${key}:[^\\r\\n]*\\r?\\n?`, "m"), "");
    }
    body = body.replace(sttSubRe("openai"), subBody.trim() === "" ? "" : `  openai:\n${subBody}`);
  }
  if (body.trim() === "") return yaml.replace(STT_BLOCK_RE, "").replace(/^\n+/, "");
  return yaml.replace(STT_BLOCK_RE, `stt:\n${body}`);
};
