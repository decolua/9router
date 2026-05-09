"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "createEnvDefinitions", {
    enumerable: true,
    get: function() {
        return createEnvDefinitions;
    }
});
const _nodepath = require("node:path");
const _promises = require("node:fs/promises");
async function createEnvDefinitions({ distDir, loadedEnvFiles }) {
    const envLines = [];
    const seenKeys = new Set();
    // env files are in order of priority
    for (const { path, env } of loadedEnvFiles){
        for(const key in env){
            if (!seenKeys.has(key)) {
                envLines.push(`      /** Loaded from \`${path}\` */`);
                envLines.push(`      ${key}?: string`);
                seenKeys.add(key);
            }
        }
    }
    const envStr = envLines.join('\n');
    const definitionStr = `// Type definitions for Next.js environment variables
declare global {
  namespace NodeJS {
    interface ProcessEnv {
${envStr}
    }
  }
}
export {}`;
    if (process.env.NODE_ENV === 'test') {
        return definitionStr;
    }
    try {
        // we expect the types directory to already exist
        const envDtsPath = (0, _nodepath.join)(distDir, 'types', 'env.d.ts');
        await (0, _promises.writeFile)(envDtsPath, definitionStr, 'utf-8');
    } catch (e) {
        console.error('Failed to write env.d.ts:', e);
    }
}

//# sourceMappingURL=create-env-definitions.js.map