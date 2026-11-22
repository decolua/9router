// Run the REAL capabilities module from the fork source and trace resolution.
import { getCapabilitiesForModel } from './open-sse/providers/capabilities.js';

for (const [provider, model] of [
  ['cloudflare-ai', '@cf/deepseek-ai/deepseek-v4.1-flash-1017'],
  ['cloudflare-ai', '@cf/thinkingmachines/inkling-2-small'],
]) {
  const caps = getCapabilitiesForModel(provider, model);
  console.log(provider, model, '-> vision:', caps.vision, '| reasoning:', caps.reasoning, '| ctx:', caps.contextWindow);
}
