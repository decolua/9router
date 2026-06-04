"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    SUPPORTED_TEST_RUNNERS_LIST: null,
    nextTest: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    SUPPORTED_TEST_RUNNERS_LIST: function() {
        return SUPPORTED_TEST_RUNNERS_LIST;
    },
    nextTest: function() {
        return nextTest;
    }
});
const _fs = require("fs");
const _getprojectdir = require("../lib/get-project-dir");
const _utils = require("../server/lib/utils");
const _config = /*#__PURE__*/ _interop_require_default(require("../server/config"));
const _constants = require("../shared/lib/constants");
const _hasnecessarydependencies = require("../lib/has-necessary-dependencies");
const _installdependencies = require("../lib/install-dependencies");
const _findup = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/find-up"));
const _findpagesdir = require("../lib/find-pages-dir");
const _verifytypescriptsetup = require("../lib/verify-typescript-setup");
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _crossspawn = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/cross-spawn"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const SUPPORTED_TEST_RUNNERS_LIST = [
    'playwright'
];
const requiredPackagesByTestRunner = {
    playwright: [
        {
            file: 'playwright',
            pkg: '@playwright/test',
            exportsRestrict: false
        }
    ]
};
async function nextTest(directory, testRunnerArgs = [], options = {}) {
    // The following mess is in order to support an existing Next.js CLI pattern of optionally, passing a project `directory` as the first argument to execute the command on.
    // This is problematic for `next test` because as a wrapper around a test runner's `test` command, it needs to pass through any additional arguments and options.
    // Thus, `directory` could either be a valid Next.js project directory (that the user intends to run `next test` on), or it is the first argument for the test runner.
    // Unfortunately, since many test runners support passing a path (to a test file or directory containing test files), we must check if `directory` is both a valid path and a valid Next.js project.
    let baseDir, nextConfig;
    try {
        // if directory is `undefined` or a valid path this will succeed.
        baseDir = (0, _getprojectdir.getProjectDir)(directory, false);
    } catch (err) {
        // if that failed, then `directory` is not a valid path, so it must have meant to be the first item for `testRunnerArgs`
        // @ts-expect-error directory is a string here since `getProjectDir` will succeed if its undefined
        testRunnerArgs.unshift(directory);
        // intentionally set baseDir to the resolved '.' path
        baseDir = (0, _getprojectdir.getProjectDir)();
    }
    try {
        // but, `baseDir` might not be a Next.js project directory, it could be a path-like argument for the test runner (i.e. `playwright test test/foo.spec.js`)
        // if this succeeds, it means that `baseDir` is a Next.js project directory
        nextConfig = await (0, _config.default)(_constants.PHASE_PRODUCTION_BUILD, baseDir);
    } catch (err) {
        // if it doesn't, then most likely `baseDir` is not a Next.js project directory
        // @ts-expect-error directory is a string here since `getProjectDir` will succeed if its undefined
        testRunnerArgs.unshift(directory);
        // intentionally set baseDir to the resolved '.' path
        baseDir = (0, _getprojectdir.getProjectDir)();
        nextConfig = await (0, _config.default)(_constants.PHASE_PRODUCTION_BUILD, baseDir) // let this error bubble up if the `basePath` is still not a valid Next.js project
        ;
    }
    // set the test runner. priority is CLI option > next config > default 'playwright'
    const configuredTestRunner = (options == null ? void 0 : options.testRunner) ?? // --test-runner='foo'
    nextConfig.experimental.defaultTestRunner ?? // { experimental: { defaultTestRunner: 'foo' }}
    'playwright';
    if (!nextConfig.experimental.testProxy) {
        return (0, _utils.printAndExit)(`\`next experimental-test\` requires the \`experimental.testProxy: true\` configuration option.`);
    }
    // execute test runner specific function
    switch(configuredTestRunner){
        case 'playwright':
            return runPlaywright(baseDir, nextConfig, testRunnerArgs);
        default:
            return (0, _utils.printAndExit)(`Test runner ${configuredTestRunner} is not supported.`);
    }
}
async function checkRequiredDeps(baseDir, testRunner) {
    const deps = (0, _hasnecessarydependencies.hasNecessaryDependencies)(baseDir, requiredPackagesByTestRunner[testRunner]);
    if (deps.missing.length > 0) {
        await (0, _installdependencies.installDependencies)(baseDir, deps.missing, true);
        const playwright = (0, _crossspawn.default)(_path.default.join(baseDir, 'node_modules', '.bin', 'playwright'), [
            'install'
        ], {
            cwd: baseDir,
            shell: false,
            stdio: 'inherit',
            env: {
                ...process.env
            }
        });
        return new Promise((resolve, reject)=>{
            playwright.on('close', (c)=>resolve(c));
            playwright.on('error', (err)=>reject(err));
        });
    }
}
async function runPlaywright(baseDir, nextConfig, testRunnerArgs) {
    await checkRequiredDeps(baseDir, 'playwright');
    const playwrightConfigFile = await (0, _findup.default)([
        'playwright.config.js',
        'playwright.config.ts'
    ], {
        cwd: baseDir
    });
    if (!playwrightConfigFile) {
        const { pagesDir, appDir } = (0, _findpagesdir.findPagesDir)(baseDir);
        const { version: typeScriptVersion } = await (0, _verifytypescriptsetup.verifyAndRunTypeScript)({
            dir: baseDir,
            distDir: nextConfig.distDir,
            strictRouteTypes: Boolean(nextConfig.experimental.strictRouteTypes),
            shouldRunTypeCheck: false,
            tsconfigPath: nextConfig.typescript.tsconfigPath,
            typedRoutes: Boolean(nextConfig.typedRoutes),
            disableStaticImages: nextConfig.images.disableStaticImages,
            hasAppDir: !!appDir,
            hasPagesDir: !!pagesDir,
            appDir: appDir || undefined,
            pagesDir: pagesDir || undefined
        });
        const isUsingTypeScript = !!typeScriptVersion;
        const playwrightConfigFilename = isUsingTypeScript ? 'playwright.config.ts' : 'playwright.config.js';
        (0, _fs.writeFileSync)(_path.default.join(baseDir, playwrightConfigFilename), defaultPlaywrightConfig(isUsingTypeScript));
        return (0, _utils.printAndExit)(`Successfully generated ${playwrightConfigFilename}. Create your first test and then run \`next experimental-test\`.`, 0);
    } else {
        const playwright = (0, _crossspawn.default)(_path.default.join(baseDir, 'node_modules', '.bin', 'playwright'), [
            'test',
            ...testRunnerArgs
        ], {
            cwd: baseDir,
            shell: false,
            stdio: 'inherit',
            env: {
                ...process.env
            }
        });
        return new Promise((resolve, reject)=>{
            playwright.on('close', (c)=>resolve(c));
            playwright.on('error', (err)=>reject(err));
        });
    }
}
function defaultPlaywrightConfig(typescript) {
    const comment = `/*
 * Specify any additional Playwright config options here.
 * They will be merged with Next.js' default Playwright config.
 * You can access the default config by importing \`defaultPlaywrightConfig\` from \`'next/experimental/testmode/playwright'\`.
 */`;
    return typescript ? `import { defineConfig } from 'next/experimental/testmode/playwright';\n\n${comment}\nexport default defineConfig({});` : `const { defineConfig } = require('next/experimental/testmode/playwright');\n\n${comment}\nmodule.exports = defineConfig({});`;
}

//# sourceMappingURL=next-test.js.map