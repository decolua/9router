"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    calcBackoffMs: null,
    recursiveDeleteSyncWithAsyncRetries: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    calcBackoffMs: function() {
        return calcBackoffMs;
    },
    recursiveDeleteSyncWithAsyncRetries: function() {
        return recursiveDeleteSyncWithAsyncRetries;
    }
});
const _nodefs = /*#__PURE__*/ _interop_require_wildcard(require("node:fs"));
const _nodepath = require("node:path");
const _iserror = /*#__PURE__*/ _interop_require_default(require("./is-error"));
const _wait = require("./wait");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
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
// We use an exponential backoff. See the unit test for example values.
//
// - Node's `fs` module uses a linear backoff, starting with 100ms.
// - Rust tries 64 times with only a `thread::yield_now` in between.
//
// We want something more aggressive, as `recursiveDelete` is in the critical
// path of `next dev` and `next build` startup.
const INITIAL_RETRY_MS = 8;
const MAX_RETRY_MS = 64;
const MAX_RETRIES = 6;
function calcBackoffMs(attempt) {
    return Math.min(INITIAL_RETRY_MS * Math.pow(2, attempt), MAX_RETRY_MS);
}
function unlinkPath(p, isDir = false, attempt = 0) {
    try {
        if (isDir) {
            _nodefs.rmdirSync(p);
        } else {
            _nodefs.unlinkSync(p);
        }
    } catch (e) {
        const code = (0, _iserror.default)(e) && e.code;
        if ((code === 'EBUSY' || code === 'ENOTEMPTY' || code === 'EPERM' || code === 'EMFILE') && attempt < MAX_RETRIES) {
            // retrying is unlikely to succeed on POSIX platforms, but Windows can
            // fail due to temporarily-open files
            return (async ()=>{
                await (0, _wait.wait)(calcBackoffMs(attempt));
                return unlinkPath(p, isDir, attempt + 1);
            })();
        }
        if (code === 'ENOENT') {
            return;
        }
        throw e;
    }
}
async function recursiveDeleteSyncWithAsyncRetries(/** Directory to delete the contents of */ dir, /** Exclude based on relative file path */ exclude, /** Relative path to the directory being deleted, used for exclude */ previousPath = '') {
    let result;
    try {
        result = _nodefs.readdirSync(dir, {
            withFileTypes: true
        });
    } catch (e) {
        if ((0, _iserror.default)(e) && e.code === 'ENOENT') {
            return;
        }
        throw e;
    }
    await Promise.all(result.map(async (part)=>{
        const absolutePath = (0, _nodepath.join)(dir, part.name);
        const pp = (0, _nodepath.join)(previousPath, part.name);
        const isNotExcluded = !exclude || !exclude.test(pp);
        if (isNotExcluded) {
            // Note: readdir does not follow symbolic links, that's good: we want to
            // delete the links and not the destination.
            let isDirectory = part.isDirectory();
            if (isDirectory) {
                await recursiveDeleteSyncWithAsyncRetries(absolutePath, exclude, pp);
            }
            return unlinkPath(absolutePath, isDirectory);
        }
    }));
}

//# sourceMappingURL=recursive-delete.js.map