"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    clearManifestCache: null,
    evalManifest: null,
    loadManifest: null,
    loadManifestFromRelativePath: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    clearManifestCache: function() {
        return clearManifestCache;
    },
    evalManifest: function() {
        return evalManifest;
    },
    loadManifest: function() {
        return loadManifest;
    },
    loadManifestFromRelativePath: function() {
        return loadManifestFromRelativePath;
    }
});
const _path = require("path");
const _fs = require("fs");
const _vm = require("vm");
const _deepfreeze = require("../shared/lib/deep-freeze");
const sharedCache = new Map();
function loadManifest(path, shouldCache = true, cache = sharedCache, skipParse = false, handleMissing) {
    const cached = shouldCache && cache.get(path);
    if (cached) {
        return cached;
    }
    let manifest;
    if (handleMissing) {
        try {
            manifest = (0, _fs.readFileSync)(/* turbopackIgnore: true */ path, 'utf8');
        } catch (err) {
            let result = {};
            cache.set(path, result);
            return result;
        }
    } else {
        manifest = (0, _fs.readFileSync)(/* turbopackIgnore: true */ path, 'utf8');
    }
    if (!skipParse) {
        manifest = JSON.parse(manifest);
        // Freeze the manifest so it cannot be modified if we're caching it.
        if (shouldCache) {
            manifest = (0, _deepfreeze.deepFreeze)(manifest);
        }
    }
    if (shouldCache) {
        cache.set(path, manifest);
    }
    return manifest;
}
function evalManifest(path, shouldCache = true, cache = sharedCache, handleMissing) {
    const cached = shouldCache && cache.get(path);
    if (cached) {
        return cached;
    }
    let content;
    if (handleMissing) {
        try {
            content = (0, _fs.readFileSync)(/* turbopackIgnore: true */ path, 'utf8');
        } catch (err) {
            let result = {};
            cache.set(path, result);
            return result;
        }
    } else {
        content = (0, _fs.readFileSync)(/* turbopackIgnore: true */ path, 'utf8');
    }
    if (content.length === 0) {
        throw Object.defineProperty(new Error('Manifest file is empty'), "__NEXT_ERROR_CODE", {
            value: "E328",
            enumerable: false,
            configurable: true
        });
    }
    let contextObject = {
        process: {
            env: {
                NEXT_DEPLOYMENT_ID: process.env.NEXT_DEPLOYMENT_ID
            }
        }
    };
    (0, _vm.runInNewContext)(content, contextObject);
    // Freeze the context object so it cannot be modified if we're caching it.
    if (shouldCache) {
        contextObject = (0, _deepfreeze.deepFreeze)(contextObject);
    }
    if (shouldCache) {
        cache.set(path, contextObject);
    }
    return contextObject;
}
function loadManifestFromRelativePath({ projectDir, distDir, manifest, shouldCache, cache, skipParse, handleMissing, useEval }) {
    const manifestPath = (0, _path.join)(/* turbopackIgnore: true */ projectDir, distDir, manifest);
    if (useEval) {
        return evalManifest(manifestPath, shouldCache, cache, handleMissing);
    }
    return loadManifest(manifestPath, shouldCache, cache, skipParse, handleMissing);
}
function clearManifestCache(path, cache = sharedCache) {
    return cache.delete(path);
}

//# sourceMappingURL=load-manifest.external.js.map