#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// ============ CONFIGURATION ============
const API_ENDPOINT = process.env.GLM_API_ENDPOINT || 'https://api.z.ai/api/anthropic/v1/messages';
const API_MODEL = process.env.GLM_API_MODEL || 'glm-5';
const API_KEY = process.env.GLM_API_KEY;
const MAX_TOKENS = parseInt(process.env.GLM_MAX_TOKENS || '32000');
const TEMPERATURE = parseFloat(process.env.GLM_TEMPERATURE || '0.3');
const BATCH_SIZE = parseInt(process.env.TRANSLATE_BATCH_SIZE || '2'); // Number of languages to translate in parallel

const SUPPORTED_LANGUAGES = {
  vi: 'Vietnamese',
  'zh-CN': 'Simplified Chinese'
};

// ============ VALIDATION ============
if (!API_KEY) {
  console.error('Error: GLM_API_KEY environment variable not set');
  process.exit(1);
}

const targetLangs = process.argv.slice(2);
if (targetLangs.length === 0) {
  console.error('Usage: node translate-readme.js <lang1> [lang2] ...');
  console.error(`Supported languages: ${Object.keys(SUPPORTED_LANGUAGES).join(', ')}`);
  process.exit(1);
}

for (const lang of targetLangs) {
  if (!SUPPORTED_LANGUAGES[lang]) {
    console.error(`Unsupported language: ${lang}`);
    process.exit(1);
  }
}

// ============ TRANSLATION FUNCTION ============
async function translateToLanguage(readmeContent, targetLang) {
  const langName = SUPPORTED_LANGUAGES[targetLang];
  console.log(`\n[${targetLang}] Translating to ${langName}...`);
  console.log(`[${targetLang}] README size: ${readmeContent.length} characters`);
  
  const prompt = `Translate this entire Markdown document to ${langName}.

CRITICAL RULES:
- Keep ALL markdown syntax EXACTLY as is (##, \`\`\`, -, *, |, tables, etc.)
- Do NOT modify code blocks, ASCII diagrams, or code fences
- Only translate human-readable text content
- Keep all URLs, links, and technical terms unchanged

${readmeContent}`;
  
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: API_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      stream: true
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`[${targetLang}] API Error: ${response.status} ${error}`);
  }
  
  console.log(`[${targetLang}] Receiving translation stream...`);
  
  let translatedContent = '';
  let chunkCount = 0;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            translatedContent += parsed.delta.text;
            chunkCount++;
            if (chunkCount % 100 === 0) {
              process.stdout.write(`\r[${targetLang}] Received ${translatedContent.length} chars...`);
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  }
  
  process.stdout.write('\n');
  
  console.log(`\n[${targetLang}] Stream complete, received ${translatedContent.length} characters`);
  
  if (!translatedContent) {
    throw new Error(`[${targetLang}] No translation received`);
  }
  
  console.log(`[${targetLang}] Fixing image paths...`);
  
  // Fix image paths
  translatedContent = translatedContent
    .replace(/!\[([^\]]*)\]\(\.\/images\//g, '![$1](../images/')
    .replace(/!\[([^\]]*)\]\(\.\/public\//g, '![$1](../public/')
    .replace(/<img src="\.\/images\//g, '<img src="../images/')
    .replace(/<img src="\.\/public\//g, '<img src="../public/');
  
  const i18nDir = path.join(__dirname, '../../i18n');
  if (!fs.existsSync(i18nDir)) {
    fs.mkdirSync(i18nDir, { recursive: true });
  }
  
  const outputPath = path.join(i18nDir, `README.${targetLang}.md`);
  fs.writeFileSync(outputPath, translatedContent, 'utf8');
  
  console.log(`[${targetLang}] ✅ Complete: ${outputPath}`);
  return { lang: targetLang, success: true, path: outputPath };
}

// ============ MAIN ============
async function main() {
  console.log('='.repeat(60));
  console.log('README Translation Tool (Streaming Mode)');
  console.log('='.repeat(60));
  console.log(`API Endpoint: ${API_ENDPOINT}`);
  console.log(`Model: ${API_MODEL}`);
  console.log(`Max Tokens: ${MAX_TOKENS}`);
  console.log(`Batch Size: ${BATCH_SIZE}`);
  console.log(`Languages: ${targetLangs.join(', ')}`);
  console.log('='.repeat(60));
  
  const readmePath = path.join(__dirname, '../../README.md');
  const readmeContent = fs.readFileSync(readmePath, 'utf8');
  
  // Translate languages in batches (parallel within batch)
  const results = [];
  for (let i = 0; i < targetLangs.length; i += BATCH_SIZE) {
    const batch = targetLangs.slice(i, i + BATCH_SIZE);
    console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(targetLangs.length / BATCH_SIZE)}: ${batch.join(', ')}`);
    console.log('Starting translations in parallel...\n');
    
    // Start all translations in parallel (don't await yet)
    const batchPromises = batch.map(lang => translateToLanguage(readmeContent, lang));
    
    // Wait for all to complete
    const batchResults = await Promise.allSettled(batchPromises);
    
    results.push(...batchResults);
    
    // Wait between batches to avoid rate limit
    if (i + BATCH_SIZE < targetLangs.length) {
      console.log('\nWaiting 3s before next batch...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      console.log(`✅ ${result.value.lang}: ${result.value.path}`);
    } else {
      console.log(`❌ ${result.lang}: ${result.reason.message}`);
    }
  });
  
  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) {
    console.log(`\n⚠️  ${failed} translation(s) failed`);
    process.exit(1);
  }
  
  console.log('\n✅ All translations completed successfully!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
