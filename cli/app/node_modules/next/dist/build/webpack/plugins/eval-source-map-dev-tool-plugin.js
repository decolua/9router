/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra

  Forked to add support for `ignoreList`.
*/ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, // Fork of webpack's EvalSourceMapDevToolPlugin with support for adding `ignoreList`.
// https://github.com/webpack/webpack/blob/e237b580e2bda705c5ab39973f786f7c5a7026bc/lib/EvalSourceMapDevToolPlugin.js#L37
"default", {
    enumerable: true,
    get: function() {
        return EvalSourceMapDevToolPlugin;
    }
});
const _webpack = require("next/dist/compiled/webpack/webpack");
const cache = new WeakMap();
const devtoolWarningMessage = `/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
`;
class EvalSourceMapDevToolPlugin {
    /**
   * @param inputOptions Options object
   */ constructor(inputOptions){
        let options;
        if (typeof inputOptions === 'string') {
            options = {
                append: inputOptions
            };
        } else {
            options = inputOptions;
        }
        this.sourceMapComment = options.append && typeof options.append !== 'function' ? options.append : '//# sourceURL=[module]\n//# sourceMappingURL=[url]';
        this.moduleFilenameTemplate = options.moduleFilenameTemplate || 'webpack://[namespace]/[resource-path]?[hash]';
        this.namespace = options.namespace || '';
        this.options = options;
        // fork
        this.shouldIgnorePath = options.shouldIgnorePath ?? (()=>false);
    }
    /**
   * Apply the plugin
   * @param compiler the compiler instance
   */ apply(compiler) {
        const options = this.options;
        compiler.hooks.compilation.tap('NextJSEvalSourceMapDevToolPlugin', (compilation)=>{
            const { JavascriptModulesPlugin } = compiler.webpack.javascript;
            const { RawSource, ConcatSource } = compiler.webpack.sources;
            const devtoolWarning = new RawSource(devtoolWarningMessage);
            const hooks = JavascriptModulesPlugin.getCompilationHooks(compilation);
            new _webpack.SourceMapDevToolModuleOptionsPlugin(options).apply(compilation);
            const matchModule = _webpack.ModuleFilenameHelpers.matchObject.bind(_webpack.ModuleFilenameHelpers, options);
            hooks.renderModuleContent.tap('NextJSEvalSourceMapDevToolPlugin', (source, m, { chunk, runtimeTemplate, chunkGraph })=>{
                const cachedSource = cache.get(source);
                if (cachedSource !== undefined) {
                    return cachedSource;
                }
                const result = (r)=>{
                    cache.set(source, r);
                    return r;
                };
                if (m instanceof _webpack.NormalModule) {
                    const module = m;
                    if (!matchModule(module.resource)) {
                        return result(source);
                    }
                } else if (m instanceof _webpack.ConcatenatedModule) {
                    const concatModule = m;
                    if (concatModule.rootModule instanceof _webpack.NormalModule) {
                        const module = concatModule.rootModule;
                        if (!matchModule(module.resource)) {
                            return result(source);
                        }
                    } else {
                        return result(source);
                    }
                } else {
                    return result(source);
                }
                const namespace = compilation.getPath(this.namespace, {
                    chunk
                });
                let sourceMap;
                let content;
                if (source.sourceAndMap) {
                    const sourceAndMap = source.sourceAndMap(options);
                    sourceMap = sourceAndMap.map;
                    content = sourceAndMap.source;
                } else {
                    sourceMap = source.map(options);
                    content = source.source();
                }
                if (!sourceMap) {
                    return result(source);
                }
                // Clone (flat) the sourcemap to ensure that the mutations below do not persist.
                sourceMap = {
                    ...sourceMap
                };
                const context = compiler.options.context;
                const root = compiler.root;
                const modules = sourceMap.sources.map((sourceMapSource)=>{
                    if (!sourceMapSource.startsWith('webpack://')) return sourceMapSource;
                    sourceMapSource = (0, _webpack.makePathsAbsolute)(context, sourceMapSource.slice(10), root);
                    const module = compilation.findModule(sourceMapSource);
                    return module || sourceMapSource;
                });
                let moduleFilenames = modules.map((module)=>_webpack.ModuleFilenameHelpers.createFilename(module, {
                        moduleFilenameTemplate: this.moduleFilenameTemplate,
                        namespace
                    }, {
                        requestShortener: runtimeTemplate.requestShortener,
                        chunkGraph,
                        hashFunction: compilation.outputOptions.hashFunction
                    }));
                moduleFilenames = _webpack.ModuleFilenameHelpers.replaceDuplicates(moduleFilenames, (filename, _i, n)=>{
                    for(let j = 0; j < n; j++)filename += '*';
                    return filename;
                });
                sourceMap.sources = moduleFilenames;
                sourceMap.ignoreList = [];
                for(let index = 0; index < moduleFilenames.length; index++){
                    if (this.shouldIgnorePath(moduleFilenames[index])) {
                        sourceMap.ignoreList.push(index);
                    }
                }
                if (options.noSources) {
                    sourceMap.sourcesContent = undefined;
                }
                sourceMap.sourceRoot = options.sourceRoot || '';
                const moduleId = chunkGraph.getModuleId(m);
                if (moduleId) {
                    sourceMap.file = typeof moduleId === 'number' ? `${moduleId}.js` : moduleId;
                }
                const footer = `${this.sourceMapComment.replace(/\[url\]/g, `data:application/json;charset=utf-8;base64,${Buffer.from(JSON.stringify(sourceMap), 'utf8').toString('base64')}`)}\n//# sourceURL=webpack-internal:///${moduleId}\n` // workaround for chrome bug
                ;
                return result(new RawSource(`eval(${compilation.outputOptions.trustedTypes ? `${_webpack.RuntimeGlobals.createScript}(${JSON.stringify(content + footer)})` : JSON.stringify(content + footer)});`));
            });
            hooks.inlineInRuntimeBailout.tap('EvalDevToolModulePlugin', ()=>'the eval-source-map devtool is used.');
            hooks.render.tap('EvalSourceMapDevToolPlugin', (source, context)=>{
                if (context.chunk.id === 'webpack' || context.chunk.id === 'webpack-runtime') {
                    const sourceURL = new URL('webpack-internal://nextjs/' + context.chunk.id + '.js');
                    // Webpack runtime chunks are not sourcemapped.
                    // We insert a dummy source map that ignore-lists everything.
                    // The mappings will be incorrect but end-users will almost never interact
                    // with the webpack runtime. Users who do, can follow the instructions
                    // in the sources content and disable sourcemaps in their debugger.
                    const sourceMappingURL = new URL('data:application/json;charset=utf-8;base64,' + Buffer.from(JSON.stringify({
                        version: 3,
                        ignoreList: [
                            0
                        ],
                        // Minimal, parseable mappings.
                        mappings: 'AAAA',
                        sources: [
                            // TODO: This should be the original source URL so that CTRL+Click works in the terminal.
                            sourceURL.toString()
                        ],
                        sourcesContent: [
                            '' + '// This source was generated by Next.js based off of the generated Webpack runtime.\n' + '// The mappings are incorrect.\n' + '// To get the correct line/column mappings, turn off sourcemaps in your debugger.\n' + '\n' + source.source()
                        ]
                    })).toString('base64'));
                    return new ConcatSource(source, new RawSource('\n//# sourceMappingURL=' + sourceMappingURL + // Webpack will add a trailing semicolon. Adding a newline
                    // ensures the semicolon is not part of the sourceURL and actually
                    // terminates the previous statement.
                    '\n'));
                } else {
                    return new ConcatSource(devtoolWarning, source);
                }
            });
            hooks.chunkHash.tap('EvalSourceMapDevToolPlugin', (_chunk, hash)=>{
                hash.update('EvalSourceMapDevToolPlugin');
                hash.update('2');
            });
            if (compilation.outputOptions.trustedTypes) {
                compilation.hooks.additionalModuleRuntimeRequirements.tap('EvalSourceMapDevToolPlugin', (_module, set, _context)=>{
                    set.add(_webpack.RuntimeGlobals.createScript);
                });
            }
        });
    }
}

//# sourceMappingURL=eval-source-map-dev-tool-plugin.js.map