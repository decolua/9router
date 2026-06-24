// DiepXuan Custom Provider API Endpoints
// Endpoints for providers specific to the DiepXuan fork.
export const DIEPXUAN_PROVIDER_ENDPOINTS = {
  alicode: "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
  "alicode-intl": "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions",
};

export function extendProviderEndpoints(baseEndpoints) {
  return {
    ...baseEndpoints,
    ...DIEPXUAN_PROVIDER_ENDPOINTS,
  };
}
