"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getRequiredConfiguration: null,
    writeConfigurationDefaults: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getRequiredConfiguration: function() {
        return getRequiredConfiguration;
    },
    writeConfigurationDefaults: function() {
        return writeConfigurationDefaults;
    }
});
const _fs = require("fs");
const _picocolors = require("../picocolors");
const _commentjson = /*#__PURE__*/ _interop_require_wildcard(require("next/dist/compiled/comment-json"));
const _semver = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/semver"));
const _os = /*#__PURE__*/ _interop_require_default(require("os"));
const _typepaths = require("./type-paths");
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../../build/output/log"));
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
function getDesiredCompilerOptions(typescriptVersion, userTsConfig) {
    var _userTsConfig_compilerOptions_module, _userTsConfig_compilerOptions, _userTsConfig_compilerOptions1;
    // ModuleKind
    const moduleKindESNext = 'esnext';
    const moduleKindES2020 = 'es2020';
    const moduleKindPreserve = 'preserve';
    const moduleKindNodeNext = 'nodenext';
    const moduleKindNode16 = 'node16';
    const moduleKindCommonJS = 'commonjs';
    const moduleKindAMD = 'amd';
    // ModuleResolutionKind
    const moduleResolutionKindBundler = 'bundler';
    const moduleResolutionKindNode10 = 'node10';
    const moduleResolutionKindNode12 = 'node12';
    const moduleResolutionKindNodeJs = 'node';
    // Jsx
    const jsxEmitReactJSX = 'react-jsx';
    return {
        target: {
            suggested: 'ES2017',
            reason: 'For top-level `await`. Note: Next.js only polyfills for the esmodules target.'
        },
        // These are suggested values and will be set when not present in the
        // tsconfig.json
        lib: {
            suggested: [
                'dom',
                'dom.iterable',
                'esnext'
            ]
        },
        allowJs: {
            suggested: true
        },
        skipLibCheck: {
            suggested: true
        },
        strict: {
            suggested: false
        },
        noEmit: {
            suggested: true
        },
        incremental: {
            suggested: true
        },
        // These values are required and cannot be changed by the user
        // Keep this in sync with the webpack config
        // 'parsedValue' matches the output value from ts.parseJsonConfigFileContent()
        module: {
            parsedValue: moduleKindESNext,
            // All of these values work:
            parsedValues: [
                _semver.default.gte(typescriptVersion, '5.4.0') && moduleKindPreserve,
                moduleKindES2020,
                moduleKindESNext,
                moduleKindCommonJS,
                moduleKindAMD,
                moduleKindNodeNext,
                moduleKindNode16
            ],
            value: 'esnext',
            reason: 'for dynamic import() support'
        },
        // TODO: Semver check not needed once Next.js repo uses 5.4.
        ..._semver.default.gte(typescriptVersion, '5.4.0') && (userTsConfig == null ? void 0 : (_userTsConfig_compilerOptions = userTsConfig.compilerOptions) == null ? void 0 : (_userTsConfig_compilerOptions_module = _userTsConfig_compilerOptions.module) == null ? void 0 : _userTsConfig_compilerOptions_module.toLowerCase()) === moduleKindPreserve ? {
        } : {
            esModuleInterop: {
                value: true,
                reason: 'requirement for SWC / babel'
            },
            moduleResolution: {
                // In TypeScript 5.0, `NodeJs` has renamed to `Node10`
                parsedValue: moduleResolutionKindBundler,
                // All of these values work:
                parsedValues: [
                    moduleResolutionKindNode10,
                    moduleResolutionKindNodeJs,
                    // only newer TypeScript versions have this field, it
                    // will be filtered for new versions of TypeScript
                    moduleResolutionKindNode12,
                    moduleKindNode16,
                    moduleKindNodeNext,
                    moduleResolutionKindBundler
                ].filter((val)=>typeof val !== 'undefined'),
                value: 'node',
                reason: 'to match webpack resolution'
            },
            resolveJsonModule: {
                value: true,
                reason: 'to match webpack resolution'
            }
        },
        ...(userTsConfig == null ? void 0 : (_userTsConfig_compilerOptions1 = userTsConfig.compilerOptions) == null ? void 0 : _userTsConfig_compilerOptions1.verbatimModuleSyntax) === true ? undefined : {
            isolatedModules: {
                value: true,
                reason: 'requirement for SWC / Babel'
            }
        },
        jsx: {
            parsedValue: jsxEmitReactJSX,
            value: 'react-jsx',
            reason: 'next.js uses the React automatic runtime'
        }
    };
}
function getRequiredConfiguration(typescript) {
    const res = {};
    const typescriptVersion = typescript.version;
    const desiredCompilerOptions = getDesiredCompilerOptions(typescriptVersion);
    for (const optionKey of Object.keys(desiredCompilerOptions)){
        const ev = desiredCompilerOptions[optionKey];
        if (!('value' in ev)) {
            continue;
        }
        const value = ev.parsedValue ?? ev.value;
        // Convert string values back to TypeScript enum values
        if (optionKey === 'module' && typeof value === 'string') {
            const moduleMap = {
                esnext: typescript.ModuleKind.ESNext,
                es2020: typescript.ModuleKind.ES2020,
                ...typescript.ModuleKind.Preserve !== undefined ? {
                    preserve: typescript.ModuleKind.Preserve
                } : {},
                nodenext: typescript.ModuleKind.NodeNext,
                node16: typescript.ModuleKind.Node16,
                commonjs: typescript.ModuleKind.CommonJS,
                amd: typescript.ModuleKind.AMD
            };
            res[optionKey] = moduleMap[value.toLowerCase()] ?? value;
        } else if (optionKey === 'moduleResolution' && typeof value === 'string') {
            const moduleResolutionMap = {
                bundler: typescript.ModuleResolutionKind.Bundler,
                node10: typescript.ModuleResolutionKind.Node10,
                node12: typescript.ModuleResolutionKind.Node12,
                node: typescript.ModuleResolutionKind.NodeJs
            };
            res[optionKey] = moduleResolutionMap[value.toLowerCase()] ?? value;
        } else if (optionKey === 'jsx' && typeof value === 'string') {
            const jsxMap = {
                'react-jsx': typescript.JsxEmit.ReactJSX
            };
            res[optionKey] = jsxMap[value.toLowerCase()] ?? value;
        } else {
            res[optionKey] = value;
        }
    }
    return res;
}
const localDevTestFilesExcludeAction = 'NEXT_PRIVATE_LOCAL_DEV_TEST_FILES_EXCLUDE';
async function writeConfigurationDefaults(typescriptVersion, tsConfigPath, isFirstTimeSetup, hasAppDir, distDir, hasPagesDir, strictRouteTypes) {
    var _userTsConfig_compilerOptions;
    if (isFirstTimeSetup) {
        (0, _fs.writeFileSync)(tsConfigPath, '{}' + _os.default.EOL);
    }
    const userTsConfigContent = (0, _fs.readFileSync)(tsConfigPath, 'utf8');
    const userTsConfig = _commentjson.parse(userTsConfigContent);
    // Bail automatic setup when the user has extended or referenced another config
    if ('extends' in userTsConfig || 'references' in userTsConfig) {
        return;
    }
    if ((userTsConfig == null ? void 0 : userTsConfig.compilerOptions) == null) {
        userTsConfig.compilerOptions = {};
        isFirstTimeSetup = true;
    }
    const desiredCompilerOptions = getDesiredCompilerOptions(typescriptVersion, userTsConfig);
    const suggestedActions = [];
    const requiredActions = [];
    for(const optionKey in desiredCompilerOptions){
        const check = desiredCompilerOptions[optionKey];
        if ('suggested' in check) {
            if (!(optionKey in (userTsConfig == null ? void 0 : userTsConfig.compilerOptions))) {
                userTsConfig.compilerOptions[optionKey] = check.suggested;
                suggestedActions.push((0, _picocolors.cyan)(optionKey) + ' was set to ' + (0, _picocolors.bold)(check.suggested) + (check.reason ? ` (${check.reason})` : ''));
            }
        } else if ('value' in check) {
            var _userTsConfig_compilerOptions1;
            let existingValue = userTsConfig == null ? void 0 : (_userTsConfig_compilerOptions1 = userTsConfig.compilerOptions) == null ? void 0 : _userTsConfig_compilerOptions1[optionKey];
            if (typeof existingValue === 'string') {
                existingValue = existingValue.toLowerCase();
            }
            const shouldWriteRequiredValue = ()=>{
                // Check if the option has multiple allowed values
                if (check.parsedValues) {
                    return !check.parsedValues.includes(existingValue);
                }
                // Check if the option has a single parsed value
                if (check.parsedValue) {
                    return check.parsedValue !== existingValue;
                }
                // Fall back to direct value comparison
                return check.value !== existingValue;
            };
            if (shouldWriteRequiredValue()) {
                if (!userTsConfig.compilerOptions) {
                    userTsConfig.compilerOptions = {};
                }
                userTsConfig.compilerOptions[optionKey] = check.value;
                requiredActions.push((0, _picocolors.cyan)(optionKey) + ' was set to ' + (0, _picocolors.bold)(check.value) + ` (${check.reason})`);
            }
        } else {
            const _ = check;
        }
    }
    // Get type definition glob patterns using shared utility to ensure consistency
    // with other TypeScript infrastructure (e.g., runTypeCheck.ts)
    const nextTypes = (0, _typepaths.getTypeDefinitionGlobPatterns)(distDir);
    if (!('include' in userTsConfig)) {
        const defaultInclude = hasAppDir && !strictRouteTypes ? [
            'next-env.d.ts',
            ...nextTypes,
            '**/*.mts',
            '**/*.ts',
            '**/*.tsx'
        ] : [
            'next-env.d.ts',
            '**/*.mts',
            '**/*.ts',
            '**/*.tsx'
        ];
        userTsConfig.include = defaultInclude;
        suggestedActions.push((0, _picocolors.cyan)('include') + ' was set to [' + (0, _picocolors.bold)(defaultInclude.map((type)=>`'${type}'`).join(', ')) + ']');
    } else if (hasAppDir && !strictRouteTypes) {
        const missingFromResolved = [];
        for (const type of nextTypes){
            if (!userTsConfig.include.includes(type)) {
                missingFromResolved.push(type);
            }
        }
        if (missingFromResolved.length > 0) {
            if (!Array.isArray(userTsConfig.include)) {
                userTsConfig.include = [];
            }
            missingFromResolved.forEach((item)=>{
                userTsConfig.include.push(item);
                suggestedActions.push((0, _picocolors.cyan)('include') + ' was updated to add ' + (0, _picocolors.bold)(`'${item}'`));
            });
        }
    }
    // Enable the Next.js typescript plugin.
    if (hasAppDir) {
        var _userTsConfig_compilerOptions2;
        // Check if the config or the resolved config has the plugin already.
        const plugins = [
            ...Array.isArray(userTsConfig == null ? void 0 : userTsConfig.plugins) ? userTsConfig.plugins : [],
            ...userTsConfig.compilerOptions && Array.isArray(userTsConfig.compilerOptions.plugins) ? userTsConfig.compilerOptions.plugins : []
        ];
        const hasNextPlugin = plugins.some(({ name })=>name === 'next');
        // If the TS config extends on another config, we can't add the `plugin` field
        // because that will override the parent config's plugins.
        // Instead we have to show a message to the user to add the plugin manually.
        if (!userTsConfig.compilerOptions || plugins.length && !hasNextPlugin && 'extends' in userTsConfig && (!userTsConfig.compilerOptions || !userTsConfig.compilerOptions.plugins)) {
            _log.info(`\nYour ${(0, _picocolors.bold)('tsconfig.json')} extends another configuration, which means we cannot add the Next.js TypeScript plugin automatically. To improve your development experience, we recommend adding the Next.js plugin (\`${(0, _picocolors.cyan)('"plugins": [{ "name": "next" }]')}\`) manually to your TypeScript configuration. Learn more: https://nextjs.org/docs/app/api-reference/config/typescript#the-typescript-plugin\n`);
        } else if (!hasNextPlugin) {
            if (!('plugins' in userTsConfig.compilerOptions)) {
                userTsConfig.compilerOptions.plugins = [];
            }
            userTsConfig.compilerOptions.plugins.push({
                name: 'next'
            });
            suggestedActions.push((0, _picocolors.cyan)('plugins') + ' was updated to add ' + (0, _picocolors.bold)(`{ name: 'next' }`));
        }
        // If `strict` is set to `false` and `strictNullChecks` is set to `false`,
        // then set `strictNullChecks` to `true`.
        if (hasPagesDir && hasAppDir && !(userTsConfig == null ? void 0 : (_userTsConfig_compilerOptions2 = userTsConfig.compilerOptions) == null ? void 0 : _userTsConfig_compilerOptions2.strict) && !('strictNullChecks' in (userTsConfig == null ? void 0 : userTsConfig.compilerOptions))) {
            userTsConfig.compilerOptions.strictNullChecks = true;
            suggestedActions.push((0, _picocolors.cyan)('strictNullChecks') + ' was set to ' + (0, _picocolors.bold)(`true`));
        }
    }
    if (!('exclude' in userTsConfig)) {
        userTsConfig.exclude = [
            'node_modules'
        ];
        suggestedActions.push((0, _picocolors.cyan)('exclude') + ' was set to ' + (0, _picocolors.bold)(`['node_modules']`));
    }
    // During local development inside Next.js repo, exclude the test files coverage by the local tsconfig
    if (process.env.NEXT_PRIVATE_LOCAL_DEV && userTsConfig.exclude) {
        const tsGlob = '**/*.test.ts';
        const tsxGlob = '**/*.test.tsx';
        let hasUpdates = false;
        if (!userTsConfig.exclude.includes(tsGlob)) {
            userTsConfig.exclude.push(tsGlob);
            hasUpdates = true;
        }
        if (!userTsConfig.exclude.includes(tsxGlob)) {
            userTsConfig.exclude.push(tsxGlob);
            hasUpdates = true;
        }
        if (hasUpdates) {
            requiredActions.push(localDevTestFilesExcludeAction);
        }
    }
    if (suggestedActions.length < 1 && requiredActions.length < 1) {
        return;
    }
    (0, _fs.writeFileSync)(tsConfigPath, _commentjson.stringify(userTsConfig, null, 2) + _os.default.EOL);
    _log.info('');
    if (isFirstTimeSetup) {
        _log.info(`We detected TypeScript in your project and created a ${(0, _picocolors.cyan)('tsconfig.json')} file for you.`);
        return;
    }
    _log.info(`We detected TypeScript in your project and reconfigured your ${(0, _picocolors.cyan)('tsconfig.json')} file for you.${((_userTsConfig_compilerOptions = userTsConfig.compilerOptions) == null ? void 0 : _userTsConfig_compilerOptions.strict) ? '' : ` Strict-mode is set to ${(0, _picocolors.cyan)('false')} by default.`}`);
    if (suggestedActions.length) {
        _log.info(`The following suggested values were added to your ${(0, _picocolors.cyan)('tsconfig.json')}. These values ${(0, _picocolors.cyan)('can be changed')} to fit your project's needs:\n`);
        suggestedActions.forEach((action)=>_log.info(`\t- ${action}`));
        _log.info('');
    }
    const requiredActionsToBeLogged = process.env.NEXT_PRIVATE_LOCAL_DEV ? requiredActions.filter((action)=>action !== localDevTestFilesExcludeAction) : requiredActions;
    if (requiredActionsToBeLogged.length) {
        _log.info(`The following ${(0, _picocolors.white)('mandatory changes')} were made to your ${(0, _picocolors.cyan)('tsconfig.json')}:\n`);
        requiredActionsToBeLogged.forEach((action)=>_log.info(`\t- ${action}`));
        _log.info('');
    }
}

//# sourceMappingURL=writeConfigurationDefaults.js.map