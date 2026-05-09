"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "verifyAndRunTypeScript", {
    enumerable: true,
    get: function() {
        return verifyAndRunTypeScript;
    }
});
const _picocolors = require("./picocolors");
const _path = /*#__PURE__*/ _interop_require_wildcard(require("path"));
const _hasnecessarydependencies = require("./has-necessary-dependencies");
const _semver = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/semver"));
const _compileerror = require("./compile-error");
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../build/output/log"));
const _getTypeScriptIntent = require("./typescript/getTypeScriptIntent");
const _writeAppTypeDeclarations = require("./typescript/writeAppTypeDeclarations");
const _writeConfigurationDefaults = require("./typescript/writeConfigurationDefaults");
const _installdependencies = require("./install-dependencies");
const _ciinfo = require("../server/ci-info");
const _missingDependencyError = require("./typescript/missingDependencyError");
const _resolvefrom = require("./resolve-from");
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
const typescriptPackage = {
    file: 'typescript/lib/typescript.js',
    pkg: 'typescript',
    exportsRestrict: true
};
const requiredPackages = [
    typescriptPackage,
    {
        file: '@types/react/index.d.ts',
        pkg: '@types/react',
        exportsRestrict: true
    },
    {
        file: '@types/node/index.d.ts',
        pkg: '@types/node',
        exportsRestrict: true
    }
];
/**
 * Check if @typescript/native-preview is installed as an alternative TypeScript compiler.
 * This is a Go-based native TypeScript compiler that can be used instead of the standard
 * TypeScript package for faster compilation.
 */ function hasNativeTypeScriptPreview(dir) {
    try {
        (0, _resolvefrom.resolveFrom)(dir, '@typescript/native-preview/package.json');
        return true;
    } catch  {
        return false;
    }
}
async function verifyAndRunTypeScript({ dir, distDir, cacheDir, strictRouteTypes, tsconfigPath, shouldRunTypeCheck, typedRoutes, disableStaticImages, hasAppDir, hasPagesDir, appDir, pagesDir, debugBuildPaths }) {
    const tsConfigFileName = tsconfigPath || 'tsconfig.json';
    const resolvedTsConfigPath = _path.default.join(dir, tsConfigFileName);
    // Construct intentDirs from appDir and pagesDir for getTypeScriptIntent
    const intentDirs = [
        pagesDir,
        appDir
    ].filter(Boolean);
    try {
        var _deps_missing, _deps_missing1;
        // Check if the project uses TypeScript:
        const intent = await (0, _getTypeScriptIntent.getTypeScriptIntent)(dir, intentDirs, tsConfigFileName);
        if (!intent) {
            return {
                version: null
            };
        }
        // Check if @typescript/native-preview is installed as an alternative
        const hasNativePreview = hasNativeTypeScriptPreview(dir);
        // Ensure TypeScript and necessary `@types/*` are installed:
        let deps = (0, _hasnecessarydependencies.hasNecessaryDependencies)(dir, requiredPackages);
        // If @typescript/native-preview is installed and only the typescript package is missing,
        // we can skip auto-installing typescript since the native preview provides TS compilation.
        // However, we still need @types/react and @types/node for type checking.
        if (hasNativePreview && ((_deps_missing = deps.missing) == null ? void 0 : _deps_missing.length) > 0) {
            const missingWithoutTypescript = deps.missing.filter((dep)=>dep.pkg !== 'typescript');
            const onlyTypescriptMissing = deps.missing.length === 1 && deps.missing[0].pkg === 'typescript';
            if (onlyTypescriptMissing) {
                // @typescript/native-preview is installed and only typescript is missing
                // Skip installation and return early - the project can use the native preview
                _log.info(`Detected ${(0, _picocolors.bold)('@typescript/native-preview')} as TypeScript compiler. ` + `Some Next.js TypeScript features (like type checking during build) require the standard ${(0, _picocolors.bold)('typescript')} package.`);
                // Still write type declarations since they don't require the typescript package
                await (0, _writeAppTypeDeclarations.writeAppTypeDeclarations)({
                    baseDir: dir,
                    distDir,
                    imageImportsEnabled: !disableStaticImages,
                    hasPagesDir,
                    hasAppDir,
                    strictRouteTypes,
                    typedRoutes
                });
                return {
                    version: null
                };
            }
            // If there are other missing deps besides typescript, only install those
            if (missingWithoutTypescript.length > 0 && missingWithoutTypescript.length < deps.missing.length) {
                deps.missing = missingWithoutTypescript;
            }
        }
        if (((_deps_missing1 = deps.missing) == null ? void 0 : _deps_missing1.length) > 0) {
            if (_ciinfo.isCI) {
                // we don't attempt auto install in CI to avoid side-effects
                // and instead log the error for installing needed packages
                (0, _missingDependencyError.missingDepsError)(dir, deps.missing);
            }
            console.log((0, _picocolors.bold)((0, _picocolors.yellow)(`It looks like you're trying to use TypeScript but do not have the required package(s) installed.`)) + '\n' + 'Installing dependencies' + '\n\n' + (0, _picocolors.bold)('If you are not trying to use TypeScript, please remove the ' + (0, _picocolors.cyan)('tsconfig.json') + ' file from your package root (and any TypeScript files in your app and pages directories).') + '\n');
            await (0, _installdependencies.installDependencies)(dir, deps.missing, true).catch((err)=>{
                if (err && typeof err === 'object' && 'command' in err) {
                    console.error(`Failed to install required TypeScript dependencies, please install them manually to continue:\n` + err.command + '\n');
                }
                throw err;
            });
            deps = (0, _hasnecessarydependencies.hasNecessaryDependencies)(dir, requiredPackages);
        }
        // Load TypeScript after we're sure it exists:
        const tsPackageJsonPath = deps.resolved.get((0, _path.join)('typescript', 'package.json'));
        const typescriptPackageJson = require(tsPackageJsonPath);
        const typescriptVersion = typescriptPackageJson.version;
        if (_semver.default.lt(typescriptVersion, '5.1.0')) {
            _log.warn(`Minimum recommended TypeScript version is v5.1.0, older versions can potentially be incompatible with Next.js. Detected: ${typescriptVersion}`);
        }
        // Reconfigure (or create) the user's `tsconfig.json` for them:
        await (0, _writeConfigurationDefaults.writeConfigurationDefaults)(typescriptVersion, resolvedTsConfigPath, intent.firstTimeSetup, hasAppDir, distDir, hasPagesDir, strictRouteTypes);
        // Write out the necessary `next-env.d.ts` file to correctly register
        // Next.js' types:
        await (0, _writeAppTypeDeclarations.writeAppTypeDeclarations)({
            baseDir: dir,
            distDir,
            imageImportsEnabled: !disableStaticImages,
            hasPagesDir,
            hasAppDir,
            strictRouteTypes,
            typedRoutes
        });
        let result;
        if (shouldRunTypeCheck) {
            const { runTypeCheck } = require('./typescript/runTypeCheck');
            // Install native bindings so that code frame rendering works in the worker
            const { installBindings } = require('../build/swc/install-bindings');
            await installBindings();
            const tsPath = deps.resolved.get('typescript');
            const typescript = await Promise.resolve(require(tsPath));
            // Verify the project passes type-checking before we go to webpack phase:
            result = await runTypeCheck(typescript, dir, distDir, resolvedTsConfigPath, cacheDir, hasAppDir, {
                app: appDir,
                pages: pagesDir
            }, debugBuildPaths);
        }
        return {
            result,
            version: typescriptVersion
        };
    } catch (err) {
        // These are special errors that should not show a stack trace:
        if (err instanceof _compileerror.CompileError) {
            console.error((0, _picocolors.red)('Failed to type check.\n'));
            console.error(err.message);
            process.exit(1);
        }
        /**
     * verifyAndRunTypeScript can be either invoked directly in the main thread (during next dev / next lint)
     * or run in a worker (during next build). In the latter case, we need to print the error message, as the
     * parent process will only receive an `Jest worker encountered 1 child process exceptions, exceeding retry limit`.
     */ // we are in a worker, print the error message and exit the process
        if (process.env.IS_NEXT_WORKER) {
            if (err instanceof Error) {
                console.error(err.message);
            } else {
                console.error(err);
            }
            process.exit(1);
        }
        // we are in the main thread, throw the error and it will be handled by the caller
        throw err;
    }
}

//# sourceMappingURL=verify-typescript-setup.js.map