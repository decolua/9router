"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    findRootDirAndLockFiles: null,
    warnDuplicatedLockFiles: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    findRootDirAndLockFiles: function() {
        return findRootDirAndLockFiles;
    },
    warnDuplicatedLockFiles: function() {
        return warnDuplicatedLockFiles;
    }
});
const _path = require("path");
const _findup = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/find-up"));
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../build/output/log"));
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
function findWorkRoot(cwd) {
    // Find-up evaluates the list of files at each level.
    // For pnpm-workspace.yaml we first want to look up before searching for lockfiles as those can be included in the application directory by accident.
    const pnpmWorkspaceFile = _findup.default.sync('pnpm-workspace.yaml', {
        cwd
    });
    if (pnpmWorkspaceFile) {
        return pnpmWorkspaceFile;
    }
    return _findup.default.sync([
        'pnpm-lock.yaml',
        'package-lock.json',
        'yarn.lock',
        'bun.lock',
        'bun.lockb'
    ], {
        cwd
    });
}
function findRootDirAndLockFiles(cwd) {
    const lockFile = findWorkRoot(cwd);
    if (!lockFile) return {
        lockFiles: [],
        rootDir: cwd
    };
    const lockFiles = [
        lockFile
    ];
    while(true){
        const lastLockFile = lockFiles[lockFiles.length - 1];
        const currentDir = (0, _path.dirname)(lastLockFile);
        const parentDir = (0, _path.dirname)(currentDir);
        // dirname('/')==='/' so if we happen to reach the FS root (as might happen in a container we need to quit to avoid looping forever
        if (parentDir === currentDir) break;
        const newLockFile = findWorkRoot(parentDir);
        if (!newLockFile) break;
        lockFiles.push(newLockFile);
    }
    return {
        lockFiles,
        rootDir: (0, _path.dirname)(lockFiles[lockFiles.length - 1])
    };
}
function warnDuplicatedLockFiles(lockFiles) {
    if (lockFiles.length > 1) {
        const additionalLockFiles = lockFiles.slice(0, -1).map((str)=>`\n   * ${str}`).join('');
        if (process.env.TURBOPACK) {
            _log.warnOnce(`Warning: Next.js inferred your workspace root, but it may not be correct.\n` + ` We detected multiple lockfiles and selected the directory of ${lockFiles[lockFiles.length - 1]} as the root directory.\n` + ` To silence this warning, set \`turbopack.root\` in your Next.js config, or consider ` + `removing one of the lockfiles if it's not needed.\n` + `   See https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory for more information.\n` + ` Detected additional lockfiles: ${additionalLockFiles}\n`);
        } else {
            _log.warnOnce(`Warning: Next.js inferred your workspace root, but it may not be correct.\n` + ` We detected multiple lockfiles and selected the directory of ${lockFiles[lockFiles.length - 1]} as the root directory.\n` + ` To silence this warning, set \`outputFileTracingRoot\` in your Next.js config, or consider ` + `removing one of the lockfiles if it's not needed.\n` + `   See https://nextjs.org/docs/app/api-reference/config/next-config-js/output#caveats for more information.\n` + ` Detected additional lockfiles: ${additionalLockFiles}\n`);
        }
    }
}

//# sourceMappingURL=find-root.js.map