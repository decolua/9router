"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, // config to parsing pageConfig for client bundles
"default", {
    enumerable: true,
    get: function() {
        return nextPageConfig;
    }
});
const _core = require("next/dist/compiled/babel/core");
const CONFIG_KEY = 'config';
function errorMessage(state, details) {
    const pageName = (state.filename || '').split(state.cwd || '').pop() || 'unknown';
    return `Invalid page config export found. ${details} in file ${pageName}. See: https://nextjs.org/docs/messages/invalid-page-config`;
}
function nextPageConfig({ types: t }) {
    return {
        visitor: {
            Program: {
                enter (path, state) {
                    path.traverse({
                        ExportDeclaration (exportPath, exportState) {
                            var _exportPath_node_specifiers;
                            if (_core.types.isExportNamedDeclaration(exportPath.node) && ((_exportPath_node_specifiers = exportPath.node.specifiers) == null ? void 0 : _exportPath_node_specifiers.some((specifier)=>{
                                return (t.isIdentifier(specifier.exported) ? specifier.exported.name : specifier.exported.value) === CONFIG_KEY;
                            })) && _core.types.isStringLiteral(exportPath.node.source)) {
                                throw Object.defineProperty(new Error(errorMessage(exportState, 'Expected object but got export from')), "__NEXT_ERROR_CODE", {
                                    value: "E394",
                                    enumerable: false,
                                    configurable: true
                                });
                            }
                        },
                        ExportNamedDeclaration (exportPath, exportState) {
                            var _exportPath_node_declaration, _exportPath_scope_getBinding;
                            if (exportState.bundleDropped || !exportPath.node.declaration && exportPath.node.specifiers.length === 0) {
                                return;
                            }
                            const declarations = [
                                ...((_exportPath_node_declaration = exportPath.node.declaration) == null ? void 0 : _exportPath_node_declaration.declarations) || [],
                                (_exportPath_scope_getBinding = exportPath.scope.getBinding(CONFIG_KEY)) == null ? void 0 : _exportPath_scope_getBinding.path.node
                            ].filter(Boolean);
                            for (const specifier of exportPath.node.specifiers){
                                if ((t.isIdentifier(specifier.exported) ? specifier.exported.name : specifier.exported.value) === CONFIG_KEY) {
                                    // export {} from 'somewhere'
                                    if (_core.types.isStringLiteral(exportPath.node.source)) {
                                        throw Object.defineProperty(new Error(errorMessage(exportState, `Expected object but got import`)), "__NEXT_ERROR_CODE", {
                                            value: "E394",
                                            enumerable: false,
                                            configurable: true
                                        });
                                    // import hello from 'world'
                                    // export { hello as config }
                                    } else if (_core.types.isIdentifier(specifier.local)) {
                                        var _exportPath_scope_getBinding1;
                                        if (_core.types.isImportSpecifier((_exportPath_scope_getBinding1 = exportPath.scope.getBinding(specifier.local.name)) == null ? void 0 : _exportPath_scope_getBinding1.path.node)) {
                                            throw Object.defineProperty(new Error(errorMessage(exportState, `Expected object but got import`)), "__NEXT_ERROR_CODE", {
                                                value: "E394",
                                                enumerable: false,
                                                configurable: true
                                            });
                                        }
                                    }
                                }
                            }
                            for (const declaration of declarations){
                                if (!_core.types.isIdentifier(declaration.id, {
                                    name: CONFIG_KEY
                                })) {
                                    continue;
                                }
                                let { init } = declaration;
                                if (_core.types.isTSAsExpression(init)) {
                                    init = init.expression;
                                }
                                if (!_core.types.isObjectExpression(init)) {
                                    const got = init ? init.type : 'undefined';
                                    throw Object.defineProperty(new Error(errorMessage(exportState, `Expected object but got ${got}`)), "__NEXT_ERROR_CODE", {
                                        value: "E394",
                                        enumerable: false,
                                        configurable: true
                                    });
                                }
                                for (const prop of init.properties){
                                    if (_core.types.isSpreadElement(prop)) {
                                        throw Object.defineProperty(new Error(errorMessage(exportState, `Property spread is not allowed`)), "__NEXT_ERROR_CODE", {
                                            value: "E394",
                                            enumerable: false,
                                            configurable: true
                                        });
                                    }
                                }
                            }
                        }
                    }, state);
                }
            }
        }
    };
}

//# sourceMappingURL=next-page-config.js.map