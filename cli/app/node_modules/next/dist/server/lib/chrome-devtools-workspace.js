"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    handleChromeDevtoolsWorkspaceRequest: null,
    isChromeDevtoolsWorkspaceUrl: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    handleChromeDevtoolsWorkspaceRequest: function() {
        return handleChromeDevtoolsWorkspaceRequest;
    },
    isChromeDevtoolsWorkspaceUrl: function() {
        return isChromeDevtoolsWorkspaceUrl;
    }
});
const _crypto = require("crypto");
const _fs = /*#__PURE__*/ _interop_require_wildcard(require("fs"));
const _path = /*#__PURE__*/ _interop_require_wildcard(require("path"));
const _cachedir = require("../cache-dir");
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
// Keep the uuid in memory as it should never change during the lifetime of the server.
let workspaceUUID = null;
function isChromeDevtoolsWorkspaceUrl(pathname) {
    return pathname === '/.well-known/appspecific/com.chrome.devtools.json';
}
async function handleChromeDevtoolsWorkspaceRequest(response, opts, config) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(await getChromeDevtoolsWorkspace(opts.dir, config.distDir), null, 2));
}
/**
 * For https://developer.chrome.com/docs/devtools/workspaces
 */ async function getChromeDevtoolsWorkspace(root, configDistDir) {
    if (workspaceUUID === null) {
        const distDir = _path.join(root, configDistDir);
        const cacheBaseDir = (0, _cachedir.getStorageDirectory)(distDir);
        if (cacheBaseDir === undefined) {
            workspaceUUID = (0, _crypto.randomUUID)();
        } else {
            const cachedUUIDPath = _path.join(cacheBaseDir, 'chrome-devtools-workspace-uuid');
            try {
                workspaceUUID = await _fs.promises.readFile(cachedUUIDPath, 'utf8');
            } catch  {
                // TODO: Why does this need to be v4 and not v5?
                // With v5 we could base it off of the `distDir` and `root` which would
                // allow us to persist the workspace across .next wipes.
                workspaceUUID = (0, _crypto.randomUUID)();
                try {
                    await _fs.promises.writeFile(cachedUUIDPath, workspaceUUID, 'utf8');
                } catch (cause) {
                    console.warn(Object.defineProperty(new Error('Failed to persist Chrome DevTools workspace UUID. The Chrome DevTools Workspace needs to be reconnected after the next page reload.', {
                        cause
                    }), "__NEXT_ERROR_CODE", {
                        value: "E708",
                        enumerable: false,
                        configurable: true
                    }));
                }
            }
        }
    }
    return {
        workspace: {
            uuid: workspaceUUID,
            root
        }
    };
}

//# sourceMappingURL=chrome-devtools-workspace.js.map