import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

export class XaiExecutor extends BaseExecutor {
  constructor() {
    super("xai", PROVIDERS.xai);
  }

  transformRequest(model, body) {
    const DENY_REASONING = ["grok-build", "grok-composer-2.5-fast"];
    const ALLOW_REASONING = ["grok-4", "grok-4.3", "grok-3"];

    let out = { ...body };
    const modelId = (out.model || model || "").toLowerCase();

    const effortLevels = ["none", "low", "medium", "high", "xhigh"];
    let modelEffort = null;
    for (const level of effortLevels) {
      if (out.model && out.model.endsWith(`-${level}`)) {
        modelEffort = level;
        out.model = out.model.replace(`-${level}`, "");
        break;
      }
    }

    const isDenied = DENY_REASONING.some((m) => modelId.includes(m));
    const isAllowed = ALLOW_REASONING.some((m) => modelId.includes(m));

    if (isDenied) {
      delete out.reasoning_effort;
    } else if (isAllowed && (body.reasoning_effort || modelEffort)) {
      out.reasoning_effort = body.reasoning_effort || modelEffort;
    }

    return out;
  }
}
