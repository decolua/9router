// Custom DiepXuan Providers
// These are specific to the DiepXuan fork and should be kept separate from base.

export const DIEPXUAN_APIKEY_PROVIDERS = {
  alicode: {
    id: "alicode",
    alias: "alicode",
    name: "Alibaba",
    icon: "cloud",
    color: "#FF6A00",
    textIcon: "ALi",
    website: "https://bailian.console.aliyun.com",
    notice: { apiKeyUrl: "https://bailian.console.aliyun.com/?apiKey=1" },
  },
  "alicode-intl": {
    id: "alicode-intl",
    alias: "alicode-intl",
    name: "Alibaba Intl",
    icon: "cloud",
    color: "#FF6A00",
    textIcon: "ALi",
    website: "https://modelstudio.console.alibabacloud.com",
    notice: { apiKeyUrl: "https://modelstudio.console.alibabacloud.com/?apiKey=1" },
  },
};

export const DIEPXUAN_USAGE_SUPPORTED_PROVIDERS = [
  "alicode",
  "alicode-intl",
];

export const DIEPXUAN_USAGE_APIKEY_PROVIDERS = [
  "alicode",
  "alicode-intl",
];

export function extendApiKeyProviders(baseProviders) {
  return {
    ...baseProviders,
    ...DIEPXUAN_APIKEY_PROVIDERS,
  };
}
