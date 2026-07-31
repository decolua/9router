/**
 * Qoder Protocol — public surface for the minimal reverse-proxy.
 *
 *   chat / createProtocol  — inference
 *   catalog helpers        — model_config list
 *   getQuota               — usage
 *   resolveProfile         — intl (+ future region data)
 *
 * Internals (encode, cosy, body, sse): import from sibling files or test-utils.
 */

import { chat } from "./chat.js";
import {
  getQoderModelConfig,
  resolveQoderModels,
  invalidateQoderCatalog,
  clearQoderCatalog,
} from "./catalog.js";
import { getQuota } from "./quota.js";
import { isQoderPat, resolvePatCredential } from "./pat.js";
import {
  INTL_PROFILE,
  CN_WORK_PROFILE,
  resolveProfile,
} from "./profile.js";

export {
  INTL_PROFILE,
  CN_WORK_PROFILE,
  resolveProfile,
  chat,
  getQoderModelConfig,
  resolveQoderModels,
  invalidateQoderCatalog,
  clearQoderCatalog,
  getQuota,
  isQoderPat,
  resolvePatCredential,
};

/**
 * Bind profile for chat / catalog / quota.
 * @param {string | import("./profile.js").QoderProfile | null | undefined} profileOrId
 */
export function createProtocol(profileOrId = null) {
  const profile = resolveProfile(profileOrId);
  return {
    profile,
    chat: (opts) => chat({ ...opts, profile }),
    getQuota: (accessToken, options = {}) => getQuota(accessToken, { ...options, profile }),
    resolveModels: (credentials, options = {}) =>
      resolveQoderModels(credentials, { ...options, profile }),
    getModelConfig: (credentials, modelKey, options = {}) =>
      getQoderModelConfig(credentials, modelKey, { ...options, profile }),
  };
}
