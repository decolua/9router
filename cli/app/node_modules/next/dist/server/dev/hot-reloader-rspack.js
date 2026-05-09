"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, /**
 * Rspack Persistent Cache Strategy for Next.js Development
 *
 * Rspack's persistent caching differs from Webpack in how it manages module graphs.
 * While Webpack incrementally updates modules, Rspack operates on complete module
 * graph snapshots for cache restoration.
 *
 * Problem:
 * - Next.js dev server starts with no page modules in the initial entry points
 * - When Rspack restores from persistent cache, it finds no modules and purges
 *   the entire module graph
 * - Later page requests find no cached module information, preventing cache reuse
 *
 * Solution:
 * - Track successfully built page entries after each compilation
 * - Restore these entries on dev server restart to maintain module graph continuity
 * - This ensures previously compiled pages can leverage persistent cache for faster builds
 */ "default", {
    enumerable: true,
    get: function() {
        return HotReloaderRspack;
    }
});
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _promises = /*#__PURE__*/ _interop_require_default(require("fs/promises"));
const _crypto = require("crypto");
const _hotreloaderwebpack = /*#__PURE__*/ _interop_require_default(require("./hot-reloader-webpack"));
const _ondemandentryhandler = require("./on-demand-entry-handler");
const _constants = require("../../shared/lib/constants");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
class HotReloaderRspack extends _hotreloaderwebpack.default {
    async afterCompile(multiCompiler) {
        // Always initialize the fallback error watcher for Rspack.
        // Rspack may restore/retain the previous build's error state, so without this
        // a page that previously failed to build might not be rebuilt on the next request.
        await super.buildFallbackError();
        const rspackStartSpan = this.hotReloaderSpan.traceChild('rspack-after-compile');
        await rspackStartSpan.traceAsyncFn(async ()=>{
            const hash = (0, _crypto.createHash)('sha1');
            multiCompiler.compilers.forEach((compiler)=>{
                const cache = compiler.options.cache;
                if (typeof cache === 'object' && 'version' in cache && cache.version) {
                    hash.update(cache.version);
                    if (compiler.name === _constants.COMPILER_NAMES.client) {
                        this.isClientCacheEnabled = true;
                    } else if (compiler.name === _constants.COMPILER_NAMES.server) {
                        this.isServerCacheEnabled = true;
                    } else if (compiler.name === _constants.COMPILER_NAMES.edgeServer) {
                        this.isEdgeServerCacheEnabled = true;
                    }
                } else {
                    hash.update('-');
                }
                return undefined;
            });
            this.builtEntriesCachePath = _path.default.join(this.distDir, 'cache', 'rspack', hash.digest('hex').substring(0, 16), 'built-entries.json');
            const hasBuiltEntriesCache = await _promises.default.access(this.builtEntriesCachePath).then(()=>true, ()=>false);
            if (hasBuiltEntriesCache) {
                try {
                    const builtEntries = JSON.parse(await _promises.default.readFile(this.builtEntriesCachePath, 'utf-8') || '{}');
                    await Promise.all(Object.keys(builtEntries).map(async (entryKey)=>{
                        const entryData = builtEntries[entryKey];
                        const isEntry = entryData.type === _ondemandentryhandler.EntryTypes.ENTRY;
                        const isChildEntry = entryData.type === _ondemandentryhandler.EntryTypes.CHILD_ENTRY;
                        // Check if the page was removed or disposed and remove it
                        if (isEntry) {
                            const pageExists = !entryData.dispose && await _promises.default.access(entryData.absolutePagePath).then(()=>true, ()=>false);
                            if (!pageExists) {
                                delete builtEntries[entryKey];
                                return;
                            } else if (!('hash' in builtEntries[entryKey]) || builtEntries[entryKey].hash !== await calculateFileHash(entryData.absolutePagePath)) {
                                delete builtEntries[entryKey];
                                return;
                            }
                        }
                        // For child entries, if it has an entry file and it's gone, remove it
                        if (isChildEntry) {
                            if (entryData.absoluteEntryFilePath) {
                                const pageExists = !entryData.dispose && await _promises.default.access(entryData.absoluteEntryFilePath).then(()=>true, ()=>false);
                                if (!pageExists) {
                                    delete builtEntries[entryKey];
                                    return;
                                } else {
                                    if (!('hash' in builtEntries[entryKey]) || builtEntries[entryKey].hash !== await calculateFileHash(entryData.absoluteEntryFilePath)) {
                                        delete builtEntries[entryKey];
                                        return;
                                    }
                                }
                            }
                        }
                    }));
                    Object.assign((0, _ondemandentryhandler.getEntries)(multiCompiler.outputPath), builtEntries);
                } catch (error) {
                    console.error('Rspack failed to read built entries cache: ', error);
                }
            }
        });
    }
    async ensurePage({ page, clientOnly, appPaths, definition, isApp, url }) {
        await super.ensurePage({
            page,
            clientOnly,
            appPaths,
            definition,
            isApp,
            url
        });
        const entries = (0, _ondemandentryhandler.getEntries)(this.multiCompiler.outputPath);
        const builtEntries = {};
        await Promise.all(Object.keys(entries).map(async (entryName)=>{
            const entry = entries[entryName];
            if (entry.status !== _ondemandentryhandler.BUILT) return;
            const result = /^(client|server|edge-server)@(app|pages|root)@(.*)/g.exec(entryName);
            const [, key /* pageType */ , , ] = result// this match should always happen
            ;
            if (key === 'client' && !this.isClientCacheEnabled) return;
            if (key === 'server' && !this.isServerCacheEnabled) return;
            if (key === 'edge-server' && !this.isEdgeServerCacheEnabled) return;
            // TODO: Rspack does not store middleware entries in persistent cache, causing
            // test/integration/middleware-src/test/index.test.ts to fail. This is a temporary
            // workaround to skip middleware entry caching until Rspack properly supports it.
            if (page === '/middleware') {
                return;
            }
            let hash;
            if (entry.type === _ondemandentryhandler.EntryTypes.ENTRY) {
                hash = await calculateFileHash(entry.absolutePagePath);
            } else if (entry.absoluteEntryFilePath) {
                hash = await calculateFileHash(entry.absoluteEntryFilePath);
            }
            if (!hash) {
                return;
            }
            builtEntries[entryName] = entry;
            builtEntries[entryName].hash = hash;
        }));
        const hasBuitEntriesCache = await _promises.default.access(this.builtEntriesCachePath).then(()=>true, ()=>false);
        try {
            if (!hasBuitEntriesCache) {
                await _promises.default.mkdir(_path.default.dirname(this.builtEntriesCachePath), {
                    recursive: true
                });
            }
            await _promises.default.writeFile(this.builtEntriesCachePath, JSON.stringify(builtEntries, null, 2));
        } catch (error) {
            console.error('Rspack failed to write built entries cache: ', error);
        }
    }
    constructor(...args){
        super(...args), this.isClientCacheEnabled = false, this.isServerCacheEnabled = false, this.isEdgeServerCacheEnabled = false;
    }
}
async function calculateFileHash(filePath, algorithm = 'sha256') {
    if (!await _promises.default.access(filePath).then(()=>true, ()=>false)) {
        return;
    }
    const fileBuffer = await _promises.default.readFile(filePath);
    const hash = (0, _crypto.createHash)(algorithm);
    hash.update(fileBuffer);
    return hash.digest('hex');
}

//# sourceMappingURL=hot-reloader-rspack.js.map