"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getNextConfigEnv: null,
    getNextPublicEnvironmentVariables: null,
    getStaticEnv: null,
    populateStaticEnv: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getNextConfigEnv: function() {
        return getNextConfigEnv;
    },
    getNextPublicEnvironmentVariables: function() {
        return getNextPublicEnvironmentVariables;
    },
    getStaticEnv: function() {
        return getStaticEnv;
    },
    populateStaticEnv: function() {
        return populateStaticEnv;
    }
});
function errorIfEnvConflicted(config, key) {
    const isPrivateKey = /^(?:NODE_.+)|^(?:__.+)$/i.test(key);
    const hasNextRuntimeKey = key === 'NEXT_RUNTIME';
    if (isPrivateKey || hasNextRuntimeKey) {
        throw Object.defineProperty(new Error(`The key "${key}" under "env" in ${config.configFileName || 'config'} is not allowed. https://nextjs.org/docs/messages/env-key-not-allowed`), "__NEXT_ERROR_CODE", {
            value: "E967",
            enumerable: false,
            configurable: true
        });
    }
}
function getNextPublicEnvironmentVariables() {
    const defineEnv = [];
    for(const key in process.env){
        if (key.startsWith('NEXT_PUBLIC_')) {
            const value = process.env[key];
            if (value != null) {
                defineEnv.push([
                    `process.env.${key}`,
                    value
                ]);
            }
        }
    }
    defineEnv.sort((a, b)=>a[0].localeCompare(b[0]));
    return Object.fromEntries(defineEnv);
}
function getNextConfigEnv(config) {
    // Refactored code below to use for-of
    const defineEnv = {};
    const env = config.env;
    for(const key in env){
        const value = env[key];
        if (value != null) {
            errorIfEnvConflicted(config, key);
            defineEnv[`process.env.${key}`] = value;
        }
    }
    return defineEnv;
}
function getStaticEnv(config, deploymentId) {
    const staticEnv = {
        ...getNextPublicEnvironmentVariables(),
        ...getNextConfigEnv(config),
        'process.env.NEXT_DEPLOYMENT_ID': deploymentId
    };
    return staticEnv;
}
function populateStaticEnv(config, deploymentId) {
    // since inlining comes after static generation we need
    // to ensure this value is assigned to process env so it
    // can still be accessed
    const staticEnv = getStaticEnv(config, deploymentId);
    for(const key in staticEnv){
        const innerKey = key.split('.').pop() || '';
        if (!process.env[innerKey]) {
            process.env[innerKey] = staticEnv[key] || '';
        }
    }
}

//# sourceMappingURL=static-env.js.map