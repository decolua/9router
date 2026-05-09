"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return _default;
    }
});
const _constant = require("../constant");
const _utils = require("../utils");
const metadata = {
    client: {
        getSemanticDiagnosticsForExportVariableStatement (fileName, node) {
            const source = (0, _utils.getSource)(fileName);
            const ts = (0, _utils.getTs)();
            // It is not allowed to export `metadata` or `generateMetadata` in client entry
            if (ts.isFunctionDeclaration(node)) {
                var _node_name;
                if (((_node_name = node.name) == null ? void 0 : _node_name.getText()) === 'generateMetadata') {
                    return [
                        {
                            file: source,
                            category: ts.DiagnosticCategory.Error,
                            code: _constant.NEXT_TS_ERRORS.INVALID_METADATA_EXPORT,
                            messageText: `The Next.js 'generateMetadata' API is not allowed in a Client Component.`,
                            start: node.name.getStart(),
                            length: node.name.getWidth()
                        }
                    ];
                }
            } else {
                for (const declaration of node.declarationList.declarations){
                    const name = declaration.name.getText();
                    if (name === 'metadata') {
                        return [
                            {
                                file: source,
                                category: ts.DiagnosticCategory.Error,
                                code: _constant.NEXT_TS_ERRORS.INVALID_METADATA_EXPORT,
                                messageText: `The Next.js 'metadata' API is not allowed in a Client Component.`,
                                start: declaration.name.getStart(),
                                length: declaration.name.getWidth()
                            }
                        ];
                    }
                }
            }
            return [];
        },
        getSemanticDiagnosticsForExportDeclaration (fileName, node) {
            const ts = (0, _utils.getTs)();
            const source = (0, _utils.getSource)(fileName);
            const diagnostics = [];
            const exportClause = node.exportClause;
            if (exportClause && ts.isNamedExports(exportClause)) {
                for (const e of exportClause.elements){
                    if ([
                        'generateMetadata',
                        'metadata'
                    ].includes(e.name.getText())) {
                        diagnostics.push({
                            file: source,
                            category: ts.DiagnosticCategory.Error,
                            code: _constant.NEXT_TS_ERRORS.INVALID_METADATA_EXPORT,
                            messageText: `The Next.js '${e.name.getText()}' API is not allowed in a Client Component.`,
                            start: e.name.getStart(),
                            length: e.name.getWidth()
                        });
                    }
                }
            }
            return diagnostics;
        }
    },
    server: {
        getSemanticDiagnosticsForExportVariableStatement (fileName, node) {
            const source = (0, _utils.getSource)(fileName);
            const ts = (0, _utils.getTs)();
            if (ts.isFunctionDeclaration(node)) {
                var _node_name;
                if (((_node_name = node.name) == null ? void 0 : _node_name.getText()) === 'generateMetadata') {
                    var _node_modifiers;
                    if (hasType(node)) {
                        return [];
                    }
                    const isAsync = (_node_modifiers = node.modifiers) == null ? void 0 : _node_modifiers.some((m)=>m.kind === ts.SyntaxKind.AsyncKeyword);
                    return [
                        {
                            file: source,
                            category: ts.DiagnosticCategory.Warning,
                            code: _constant.NEXT_TS_ERRORS.INVALID_METADATA_EXPORT,
                            messageText: `The Next.js "generateMetadata" export should have a return type of ${isAsync ? '"Promise<Metadata>"' : '"Metadata"'} from "next".`,
                            start: node.name.getStart(),
                            length: node.name.getWidth()
                        }
                    ];
                }
            } else {
                for (const declaration of node.declarationList.declarations){
                    if (hasType(declaration)) {
                        return [];
                    }
                    const name = declaration.name.getText();
                    if (name === 'metadata') {
                        return [
                            {
                                file: source,
                                category: ts.DiagnosticCategory.Warning,
                                code: _constant.NEXT_TS_ERRORS.INVALID_METADATA_EXPORT,
                                messageText: `The Next.js "metadata" export should be type of "Metadata" from "next".`,
                                start: declaration.name.getStart(),
                                length: declaration.name.getWidth()
                            }
                        ];
                    }
                    if (name === 'generateMetadata') {
                        // Check if it's a function expression or arrow function
                        if (declaration.initializer && (ts.isFunctionExpression(declaration.initializer) || ts.isArrowFunction(declaration.initializer))) {
                            var _declaration_initializer_modifiers;
                            const isAsync = (_declaration_initializer_modifiers = declaration.initializer.modifiers) == null ? void 0 : _declaration_initializer_modifiers.some((m)=>m.kind === ts.SyntaxKind.AsyncKeyword);
                            return [
                                {
                                    file: source,
                                    category: ts.DiagnosticCategory.Warning,
                                    code: _constant.NEXT_TS_ERRORS.INVALID_METADATA_EXPORT,
                                    messageText: `The Next.js "generateMetadata" export should have a return type of ${isAsync ? '"Promise<Metadata>"' : '"Metadata"'} from "next".`,
                                    start: declaration.name.getStart(),
                                    length: declaration.name.getWidth()
                                }
                            ];
                        }
                    }
                }
            }
            return [];
        },
        getSemanticDiagnosticsForExportDeclaration (fileName, node) {
            const typeChecker = (0, _utils.getTypeChecker)();
            if (!typeChecker) {
                return [];
            }
            const ts = (0, _utils.getTs)();
            const source = (0, _utils.getSource)(fileName);
            const diagnostics = [];
            const exportClause = node.exportClause;
            if (!node.isTypeOnly && exportClause && ts.isNamedExports(exportClause)) {
                for (const e of exportClause.elements){
                    if (e.isTypeOnly) {
                        continue;
                    }
                    const exportName = e.name.getText();
                    if (exportName !== 'metadata' && exportName !== 'generateMetadata') {
                        continue;
                    }
                    const symbol = typeChecker.getSymbolAtLocation(e.name);
                    if (!symbol) {
                        continue;
                    }
                    const originalSymbol = typeChecker.getAliasedSymbol(symbol);
                    const declarations = originalSymbol.getDeclarations();
                    if (!declarations) {
                        continue;
                    }
                    const declaration = declarations[0];
                    if (hasType(declaration)) {
                        continue;
                    }
                    if (exportName === 'generateMetadata') {
                        let isAsync = false;
                        // async function() {}
                        if (ts.isFunctionDeclaration(declaration)) {
                            var _declaration_modifiers;
                            isAsync = ((_declaration_modifiers = declaration.modifiers) == null ? void 0 : _declaration_modifiers.some((m)=>m.kind === ts.SyntaxKind.AsyncKeyword)) ?? false;
                        }
                        // foo = async function() {}
                        // foo = async () => {}
                        if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
                            const initializer = declaration.initializer;
                            const isFunction = ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer);
                            if (isFunction) {
                                var _initializer_modifiers;
                                isAsync = ((_initializer_modifiers = initializer.modifiers) == null ? void 0 : _initializer_modifiers.some((m)=>m.kind === ts.SyntaxKind.AsyncKeyword)) ?? false;
                            }
                        }
                        diagnostics.push({
                            file: source,
                            category: ts.DiagnosticCategory.Warning,
                            code: _constant.NEXT_TS_ERRORS.INVALID_METADATA_EXPORT,
                            messageText: `The Next.js "generateMetadata" export should have a return type of ${isAsync ? '"Promise<Metadata>"' : '"Metadata"'} from "next".`,
                            start: e.name.getStart(),
                            length: e.name.getWidth()
                        });
                    } else {
                        diagnostics.push({
                            file: source,
                            category: ts.DiagnosticCategory.Warning,
                            code: _constant.NEXT_TS_ERRORS.INVALID_METADATA_EXPORT,
                            messageText: `The Next.js "metadata" export should be type of "Metadata" from "next".`,
                            start: e.name.getStart(),
                            length: e.name.getWidth()
                        });
                    }
                }
            }
            return diagnostics;
        }
    }
};
function hasType(node) {
    const ts = (0, _utils.getTs)();
    if (!ts.isVariableDeclaration(node) && !ts.isFunctionDeclaration(node) && !ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) {
        return false;
    }
    // For function declarations, expressions, and arrow functions, check if they have return type
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
        return !!node.type;
    }
    // For variable declarations
    if (!node.name) return false;
    const name = node.name.getText();
    if (name === 'generateMetadata') {
        // If it's a function expression or arrow function, check if it has return type
        if (node.initializer && (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer))) {
            return !!node.initializer.type;
        }
    }
    // For all other cases, check if the node has a type annotation
    return !!node.type;
}
const _default = metadata;

//# sourceMappingURL=metadata.js.map