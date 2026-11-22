// Reproduce the full chatCore translation pipeline locally for the cf deepseek model.
import { translateRequest } from './open-sse/translator/index.js';
import { FORMATS, detectFormatByEndpoint } from './open-sse/translator/formats.js';
import { getModelStrip } from './open-sse/config/providerModels.js';
import { initTranslators } from './open-sse/translator/index.js';

await initTranslators();

const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const body = {
  model: 'cf/@cf/deepseek-ai/deepseek-v4.1-flash-1017',
  stream: false,
  messages: [{ role: 'user', content: [
    { type: 'text', text: 'What color is this image? One word.' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64 } },
  ]}],
};

const model = '@cf/deepseek-ai/deepseek-v4.1-flash-1017';
const stripList = getModelStrip('cloudflare-ai', model);
console.log('stripList:', stripList);

const translated = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, model, body, false, null, 'cloudflare-ai');
const content = translated.messages?.[0]?.content;
console.log('content types after translation:', Array.isArray(content) ? content.map(c => c.type) : typeof content);
console.log('image survived translation:', JSON.stringify(content).includes('image_url'));
console.log(JSON.stringify(content).slice(0, 300));
