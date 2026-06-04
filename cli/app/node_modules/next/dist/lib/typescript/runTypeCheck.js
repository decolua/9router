"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "runTypeCheck", {
    enumerable: true,
    get: function() {
        return runTypeCheck;
    }
});
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _diagnosticFormatter = require("./diagnosticFormatter");
const _getTypeScriptConfiguration = require("./getTypeScriptConfiguration");
const _writeConfigurationDefaults = require("./writeConfigurationDefaults");
const _typepaths = require("./type-paths");
const _compileerror = require("../compile-error");
const _log = require("../../build/output/log");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
/**
 * Check if a file path matches any of the debug build paths.
 * Both filePath and debugPaths are resolved file paths from glob.
 */ function fileMatchesDebugPaths(filePath, debugPaths) {
    return debugPaths.includes(filePath);
}
async function runTypeCheck(typescript, baseDir, distDir, tsConfigPath, cacheDir, isAppDirEnabled, dirs, debugBuildPaths) {
    const effectiveConfiguration = await (0, _getTypeScriptConfiguration.getTypeScriptConfiguration)(typescript, tsConfigPath);
    // tsconfig includes both .next/types and .next/dev/types to avoid config churn
    // between dev/build modes. During build, we filter out .next/dev/types files to
    // prevent stale dev types from causing errors when routes have been deleted since
    // the last dev session.
    let fileNames = effectiveConfiguration.fileNames;
    // Get the dev types path to filter (null if not applicable)
    const devTypesDir = (0, _typepaths.getDevTypesPath)(baseDir, distDir);
    if (devTypesDir) {
        fileNames = fileNames.filter((fileName)=>!fileName.startsWith(devTypesDir));
    }
    // Apply debug build paths filter if specified
    if (dirs && debugBuildPaths) {
        const { app: appDir, pages: pagesDir } = dirs;
        const { app: debugAppPaths, pages: debugPagePaths } = debugBuildPaths;
        fileNames = fileNames.filter((fileName)=>{
            // Check if file is in app directory
            if (appDir && fileName.startsWith(appDir + _path.default.sep)) {
                // If debugAppPaths is undefined, include all app files
                if (debugAppPaths === undefined) {
                    return true;
                }
                // If debugAppPaths is empty array, exclude all app files
                if (debugAppPaths.length === 0) {
                    return false;
                }
                // Check if file matches any of the debug paths
                const relativeToApp = fileName.slice(appDir.length);
                return fileMatchesDebugPaths(relativeToApp, debugAppPaths);
            }
            // Check if file is in pages directory
            if (pagesDir && fileName.startsWith(pagesDir + _path.default.sep)) {
                // If debugPagePaths is undefined, include all pages files
                if (debugPagePaths === undefined) {
                    return true;
                }
                // If debugPagePaths is empty array, exclude all pages files
                if (debugPagePaths.length === 0) {
                    return false;
                }
                // Check if file matches any of the debug paths
                const relativeToPages = fileName.slice(pagesDir.length);
                return fileMatchesDebugPaths(relativeToPages, debugPagePaths);
            }
            // Keep files outside app/pages directories (shared code, etc.)
            return true;
        });
    }
    if (fileNames.length < 1) {
        return {
            hasWarnings: false,
            inputFilesCount: 0,
            totalFilesCount: 0,
            incremental: false
        };
    }
    const requiredConfig = (0, _writeConfigurationDefaults.getRequiredConfiguration)(typescript);
    const options = {
        ...requiredConfig,
        ...effectiveConfiguration.options,
        declarationMap: false,
        emitDeclarationOnly: false,
        noEmit: true
    };
    let program;
    let incremental = false;
    if ((options.incremental || options.composite) && cacheDir) {
        if (options.composite) {
            (0, _log.warn)('TypeScript project references are not fully supported. Attempting to build in incremental mode.');
        }
        incremental = true;
        program = typescript.createIncrementalProgram({
            rootNames: fileNames,
            options: {
                ...options,
                composite: false,
                incremental: true,
                tsBuildInfoFile: _path.default.join(cacheDir, '.tsbuildinfo')
            }
        });
    } else {
        program = typescript.createProgram(fileNames, options);
    }
    const result = program.emit();
    const ignoreRegex = [
        // matches **/__(tests|mocks)__/**
        /[\\/]__(?:tests|mocks)__[\\/]/,
        // matches **/*.(spec|test).*
        /(?<=[\\/.])(?:spec|test)\.[^\\/]+$/
    ];
    const regexIgnoredFile = new RegExp(ignoreRegex.map((r)=>r.source).join('|'));
    const allDiagnostics = typescript.getPreEmitDiagnostics(program).concat(result.diagnostics).filter((d)=>!(d.file && regexIgnoredFile.test(d.file.fileName)));
    const firstError = allDiagnostics.find((d)=>d.category === typescript.DiagnosticCategory.Error && Boolean(d.file)) ?? allDiagnostics.find((d)=>d.category === typescript.DiagnosticCategory.Error);
    // In test mode, we want to check all diagnostics, not just the first one.
    if (process.env.__NEXT_TEST_MODE) {
        if (firstError) {
            const allErrors = allDiagnostics.filter((d)=>d.category === typescript.DiagnosticCategory.Error).map((d)=>'[Test Mode] ' + (0, _diagnosticFormatter.getFormattedDiagnostic)(typescript, baseDir, distDir, d, isAppDirEnabled));
            console.error('\n\n===== TS errors =====\n\n' + allErrors.join('\n\n') + '\n\n===== TS errors =====\n\n');
            // Make sure all stdout is flushed before we exit.
            await new Promise((resolve)=>setTimeout(resolve, 100));
        }
    }
    if (firstError) {
        throw Object.defineProperty(new _compileerror.CompileError((0, _diagnosticFormatter.getFormattedDiagnostic)(typescript, baseDir, distDir, firstError, isAppDirEnabled)), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
    const warnings = allDiagnostics.filter((d)=>d.category === typescript.DiagnosticCategory.Warning).map((d)=>(0, _diagnosticFormatter.getFormattedDiagnostic)(typescript, baseDir, distDir, d, isAppDirEnabled));
    return {
        hasWarnings: true,
        warnings,
        inputFilesCount: fileNames.length,
        totalFilesCount: program.getSourceFiles().length,
        incremental
    };
}

//# sourceMappingURL=runTypeCheck.js.map