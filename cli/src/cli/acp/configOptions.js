/**
 * ACP `configOptions` — the model picker.
 *
 * This is the piece that removes manual model entry from the editor: the
 * agent publishes every tool-capable model and combo the gateway knows about
 * (grouped, combos first) and the client renders a selector. Values are the
 * gateway's own model ids (`kr/claude-sonnet-4.5`, combo names, …).
 */

const MODEL_CAP = 200;

// Non-LLM endpoints (webSearch/webFetch, TTS, image, …) carry a `kind`; models
// without tool support cannot drive an agent loop, so both are excluded.
function isAgentModel(m) {
  return Boolean(m?.id) && !m.kind && m.capabilities?.tools !== false;
}

function groupOf(m) {
  if (m.owned_by === "combo") return { group: "combos", name: "Combos" };
  const alias = m.owned_by || String(m.id).split("/")[0] || "other";
  return { group: alias, name: alias };
}

function optionOf(m) {
  const ctx = m.context_length ? `ctx ${Math.round(m.context_length / 1000)}k` : "";
  const caps = [];
  if (ctx) caps.push(ctx);
  if (m.capabilities?.reasoning) caps.push("reasoning");
  if (m.capabilities?.vision) caps.push("vision");
  return {
    value: m.id,
    name: m.id,
    description: caps.join(" · ") || null,
  };
}

/** Ordered groups: combos first, then providers in gateway order. */
function buildModelOptions(rawModels) {
  const usable = (rawModels || []).filter(isAgentModel).slice(0, MODEL_CAP);
  const combos = usable.filter((m) => m.owned_by === "combo");
  const rest = usable.filter((m) => m.owned_by !== "combo");
  const order = [];
  const byGroup = new Map();
  for (const m of [...combos, ...rest]) {
    const { group, name } = groupOf(m);
    if (!byGroup.has(group)) {
      byGroup.set(group, { group, name, options: [] });
      order.push(group);
    }
    byGroup.get(group).options.push(optionOf(m));
  }
  return order.map((g) => byGroup.get(g)).filter((g) => g.options.length);
}

function defaultModel(rawModels, preferred) {
  const usable = (rawModels || []).filter(isAgentModel);
  if (preferred && usable.some((m) => m.id === preferred)) return preferred;
  const combo = usable.find((m) => m.owned_by === "combo");
  if (combo) return combo.id;
  return usable[0]?.id || null;
}

/**
 * Full configOptions payload for a session.
 * `booleanCapable` mirrors clientCapabilities.session.configOptions.boolean —
 * the spec forbids boolean options when the client did not advertise it, so a
 * select fallback is used instead.
 */
function buildConfigOptions({ models = [], currentValue, tokenSaver = true, booleanCapable = false, fallbackModel = null }) {
  const groups = buildModelOptions(models);
  const options = [];
  if (groups.length) {
    options.push({
      id: "model",
      name: "Model",
      description: "9Router model or combo (auto-discovered from the gateway)",
      category: "model",
      type: "select",
      currentValue: currentValue || defaultModel(models) || fallbackModel || groups[0].options[0].value,
      options: groups,
    });
  }
  if (booleanCapable) {
    options.push({
      id: "_token_saver",
      name: "RTK Token Saver",
      description: "Compress tool outputs before they reach the model (saves 20-40% input tokens)",
      category: "_9router",
      type: "boolean",
      currentValue: tokenSaver,
    });
  } else {
    options.push({
      id: "_token_saver",
      name: "RTK Token Saver",
      description: "Compress tool outputs before they reach the model (saves 20-40% input tokens)",
      category: "_9router",
      type: "select",
      currentValue: tokenSaver ? "on" : "off",
      options: [
        { value: "on", name: "On" },
        { value: "off", name: "Off" },
      ],
    });
  }
  return options;
}

/** Apply a client-side change; returns the mutated list (sent back complete). */
function applyConfigValue(options, configId, value) {
  for (const o of options) {
    if (o.id !== configId) continue;
    if (o.type === "boolean") o.currentValue = Boolean(value);
    else o.currentValue = String(value);
  }
  return options;
}

module.exports = {
  buildConfigOptions,
  buildModelOptions,
  applyConfigValue,
  defaultModel,
  isAgentModel,
  __test__: { buildModelOptions, defaultModel, applyConfigValue },
};
