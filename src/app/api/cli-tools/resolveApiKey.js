// The stored credential belongs to this tool and endpoint, never to the dashboard list.
export class CliKeySelectionError extends Error {}

export function resolveCliApiKey(selected, destination, savedUrl, savedKey) {
  const usable = key => typeof key === "string" && key.trim() && key.trim() !== "sk_9router"
    && !/[\s*•…]/u.test(key.trim()) && !key.includes("...") && !key.includes("<");
  if (usable(selected)) return selected.trim();
  if (selected != null && (typeof selected !== "string" || selected.trim() && selected.trim() !== "sk_9router"))
    throw new CliKeySelectionError("Select a complete API key.");
  if (typeof savedUrl === "string" && destination === savedUrl && usable(savedKey)) return savedKey;
  throw new CliKeySelectionError("Select an API key for this endpoint. Tool settings were not changed.");
}
