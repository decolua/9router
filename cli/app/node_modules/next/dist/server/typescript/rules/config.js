// This module provides intellisense for page and layout's exported configs.
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
const _utils = require("../utils");
const _constant = require("../constant");
const API_DOCS = {
    dynamic: {
        description: 'The `dynamic` option provides a few ways to opt in or out of dynamic behavior.',
        options: {
            '"auto"': "Heuristic to cache as much as possible but doesn't prevent any component to opt-in to dynamic behavior.",
            '"force-dynamic"': 'This disables all caching of fetches and always revalidates. (This is equivalent to `getServerSideProps`.)',
            '"error"': 'This errors if any dynamic Hooks or fetches are used. (This is equivalent to `getStaticProps`.)',
            '"force-static"': 'This forces caching of all fetches and returns empty values from `cookies`, `headers` and `useSearchParams`.'
        },
        link: 'https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#dynamic'
    },
    fetchCache: {
        description: "The `fetchCache` option controls how Next.js statically caches fetches. By default it statically caches fetches reachable before any dynamic Hooks are used, and it doesn't cache fetches that are discovered after that.",
        options: {
            '"force-no-store"': "This lets you intentionally opt-out of all caching of data. This option forces all fetches to be refetched every request even if the `cache: 'force-cache'` option is passed to `fetch()`.",
            '"only-no-store"': "This lets you enforce that all data opts out of caching. This option makes `fetch()` reject with an error if `cache: 'force-cache'` is provided. It also changes the default to `no-store`.",
            '"default-no-store"': "Allows any explicit `cache` option to be passed to `fetch()` but if `'default'`, or no option, is provided then it defaults to `'no-store'`. This means that even fetches before a dynamic Hook are considered dynamic.",
            '"auto"': "This is the default option. It caches any fetches with the default `cache` option provided, that happened before a dynamic Hook is used and don't cache any such fetches if they're issued after a dynamic Hook.",
            '"default-cache"': "Allows any explicit `cache` option to be passed to `fetch()` but if `'default'`, or no option, is provided then it defaults to `'force-cache'`. This means that even fetches before a dynamic Hook are considered dynamic.",
            '"only-cache"': "This lets you enforce that all data opts into caching. This option makes `fetch()` reject with an error if `cache: 'force-cache'` is provided. It also changes the default to `force-cache`. This error can be discovered early during static builds - or dynamically during Edge rendering.",
            '"force-cache"': "This lets you intentionally opt-in to all caching of data. This option forces all fetches to be cache even if the `cache: 'no-store'` option is passed to `fetch()`."
        },
        link: 'https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#fetchcache'
    },
    preferredRegion: {
        description: 'Specify the perferred region that this layout or page should be deployed to. If the region option is not specified, it inherits the option from the nearest parent layout. The root defaults to `"auto"`.\n\nYou can also specify a region, such as "iad1", or an array of regions, such as `["iad1", "sfo1"]`.',
        options: {
            '"auto"': 'Next.js will first deploy to the `"home"` region. Then if it doesn\'t detect any waterfall requests after a few requests, it can upgrade that route, to be deployed globally. If it detects any waterfall requests after that, it can eventually downgrade back to `"home`".',
            '"global"': 'Prefer deploying globally.',
            '"home"': 'Prefer deploying to the Home region.'
        },
        link: 'https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#preferredregion',
        isValid: (value)=>{
            try {
                const parsed = JSON.parse(value);
                return typeof parsed === 'string' || Array.isArray(parsed) && !parsed.some((v)=>typeof v !== 'string');
            } catch (err) {
                return false;
            }
        },
        getHint: (value)=>{
            if (value === 'auto') return `Automatically chosen by Next.js.`;
            if (value === 'global') return `Prefer deploying globally.`;
            if (value === 'home') return `Prefer deploying to the Home region.`;
            if (Array.isArray(value)) return `Deploy to regions: ${value.join(', ')}.`;
            if (typeof value === 'string') return `Deploy to region: ${value}.`;
        }
    },
    revalidate: {
        description: "The `revalidate` option sets the default revalidation time for that layout or page. Note that it doesn't override the value specify by each `fetch()`.",
        type: 'mixed',
        options: {
            false: 'This is the default and changes the fetch cache to indefinitely cache anything that uses force-cache or is fetched before a dynamic Hook/fetch.',
            0: 'Specifying `0` implies that this layout or page should never be static.',
            30: 'Set the revalidation time to `30` seconds. The value can be `0` or any positive number.'
        },
        link: 'https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#revalidate',
        isValid: (value)=>{
            return value === 'false' || Number(value.replace(/_/g, '')) >= 0;
        },
        getHint: (value)=>{
            return `Set the default revalidation time to \`${value}\` seconds.`;
        }
    },
    dynamicParams: {
        description: '`dynamicParams` replaces the `fallback` option of `getStaticPaths`. It controls whether we allow `dynamicParams` beyond the generated static params from `generateStaticParams`.',
        options: {
            true: 'Allow rendering dynamic params that are not generated by `generateStaticParams`.',
            false: 'Disallow rendering dynamic params that are not generated by `generateStaticParams`.'
        },
        link: 'https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#dynamicparams',
        isValid: (value)=>{
            return value === 'true' || value === 'false';
        }
    },
    runtime: {
        description: 'The `runtime` option controls the preferred runtime to render this route.',
        options: {
            '"nodejs"': 'Prefer the Node.js runtime.',
            '"edge"': 'Prefer the Edge runtime.',
            '"experimental-edge"': `@deprecated\n\nThis option is no longer experimental. Use \`edge\` instead.`
        },
        link: 'https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#runtime'
    },
    metadata: {
        description: 'Next.js Metadata configurations',
        link: 'https://nextjs.org/docs/app/building-your-application/optimizing/metadata',
        insertText: 'metadata: Metadata = {};'
    },
    generateMetadata: {
        description: 'Next.js generateMetadata configurations',
        link: 'https://nextjs.org/docs/app/api-reference/functions/generate-metadata',
        insertText: 'generateMetadata = (): Metadata => { return {} };'
    },
    maxDuration: {
        description: '`maxDuration` allows you to set max default execution time for your function. If it is not specified, the default value is dependent on your deployment platform and plan.',
        link: 'https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#maxduration'
    },
    unstable_instant: {
        description: `Specifies the default prefetching behavior for this segment. This configuration is currently under development and will change.`,
        link: '(docs coming soon)',
        type: 'object | false',
        // TODO: ideally, we'd validate the config object somehow, but this is difficult to do
        // with the way this plugin is currently structured.
        // For now, since we don't provide an `options` here, we won't do any validation in
        // `getSemanticDiagnosticsForExportVariableStatement` below, and only provide hover a tooltip + autocomplete.
        insertText: 'unstable_instant = { prefetch: "static" };'
    },
    unstable_dynamicStaleTime: {
        description: `Controls how long the client-side router cache retains dynamic page data (in seconds). Pages only — not allowed in layouts. Cannot be combined with \`unstable_instant\`.`,
        link: '(docs coming soon)',
        type: 'number',
        isValid: (value)=>{
            return Number(value.replace(/_/g, '')) >= 0;
        },
        getHint: (value)=>{
            return `Set the dynamic stale time to \`${value}\` seconds.`;
        }
    }
};
function visitEntryConfig(fileName, position, callback) {
    const source = (0, _utils.getSource)(fileName);
    if (source) {
        const ts = (0, _utils.getTs)();
        ts.forEachChild(source, function visit(node) {
            // Covered by this node
            if ((0, _utils.isPositionInsideNode)(position, node)) {
                var _node_modifiers;
                // Export variable
                if (ts.isVariableStatement(node) && ((_node_modifiers = node.modifiers) == null ? void 0 : _node_modifiers.some((m)=>m.kind === ts.SyntaxKind.ExportKeyword))) {
                    if (ts.isVariableDeclarationList(node.declarationList)) {
                        for (const declaration of node.declarationList.declarations){
                            if ((0, _utils.isPositionInsideNode)(position, declaration)) {
                                // `export const ... = ...`
                                const text = declaration.name.getText();
                                callback(text, declaration);
                            }
                        }
                    }
                }
            }
        });
    }
}
function createAutoCompletionOptionName(sort, name) {
    const ts = (0, _utils.getTs)();
    return {
        name,
        insertText: API_DOCS[name].insertText,
        sortText: '!' + sort,
        kind: ts.ScriptElementKind.constElement,
        kindModifiers: ts.ScriptElementKindModifier.exportedModifier,
        labelDetails: {
            description: `Next.js ${name} option`
        },
        data: {
            exportName: name,
            moduleSpecifier: 'next/typescript/entry_option_name'
        }
    };
}
function createAutoCompletionOptionValue(sort, name, apiName) {
    const ts = (0, _utils.getTs)();
    const isString = name.startsWith('"');
    return {
        name,
        insertText: (0, _utils.removeStringQuotes)(name),
        sortText: '' + sort,
        kind: isString ? ts.ScriptElementKind.string : ts.ScriptElementKind.unknown,
        kindModifiers: ts.ScriptElementKindModifier.none,
        labelDetails: {
            description: `Next.js ${apiName} option`
        },
        data: {
            exportName: apiName,
            moduleSpecifier: 'next/typescript/entry_option_value'
        }
    };
}
function getAPIDescription(api) {
    return API_DOCS[api].description + '\n\n' + Object.entries(API_DOCS[api].options || {}).map(([key, value])=>`- \`${key}\`: ${value}`).join('\n');
}
const config = {
    // Auto completion for entry exported configs.
    addCompletionsAtPosition (fileName, position, prior) {
        visitEntryConfig(fileName, position, (entryConfig, declaration)=>{
            if (!API_DOCS[entryConfig]) {
                if ((0, _utils.isPositionInsideNode)(position, declaration.name)) {
                    prior.entries.push(...Object.keys(API_DOCS).map((name, index)=>{
                        return createAutoCompletionOptionName(index, name);
                    }));
                }
                return;
            }
            prior.entries.push(...Object.keys(API_DOCS[entryConfig].options || {}).map((name, index)=>{
                return createAutoCompletionOptionValue(index, name, entryConfig);
            }));
        });
    },
    // Show docs when hovering on the exported configs.
    getQuickInfoAtPosition (fileName, position) {
        const ts = (0, _utils.getTs)();
        let overridden;
        visitEntryConfig(fileName, position, (entryConfig, declaration)=>{
            if (!API_DOCS[entryConfig]) return;
            const name = declaration.name;
            const value = declaration.initializer;
            const docsLink = {
                kind: 'text',
                text: `\n\nRead more about the "${entryConfig}" option: ` + API_DOCS[entryConfig].link
            };
            // When the value is a flexible type (like a function), also compute its
            // inferred type so we can surface it alongside the docs. This is useful
            // even when the value is considered invalid by the config validation,
            // as long as it's not a direct literal export.
            let displayParts = [];
            const typeChecker = (0, _utils.getTypeChecker)();
            const isString = !!value && ts.isStringLiteral(value);
            const isFunctionValue = !!value && !isString && (ts.isArrowFunction(value) || ts.isFunctionExpression(value) || ts.isFunctionDeclaration(value));
            if (typeChecker && value && isFunctionValue) {
                try {
                    // If we're hovering the config identifier, ask for the type at the
                    // identifier; otherwise, ask at the value node. This makes sure
                    // highlighting `generateMetadata` itself also shows the inferred type.
                    const typeTarget = (0, _utils.isPositionInsideNode)(position, name) ? name : value;
                    const type = typeChecker.getTypeAtLocation(typeTarget);
                    if (type) {
                        const typeString = typeChecker.typeToString(type, typeTarget);
                        if (typeString) {
                            displayParts = [
                                {
                                    text: typeString,
                                    kind: 'typeName'
                                }
                            ];
                        }
                    }
                } catch  {
                // If type checking fails, continue without type info.
                }
            }
            // For non-function values (like literals), hovering the value should show
            // option-specific docs. For function-valued configs (e.g. `generateMetadata`),
            // we let TypeScript handle hover anywhere in the initializer except for the
            // export identifier itself.
            if (value && !isFunctionValue && (0, _utils.isPositionInsideNode)(position, value)) {
                var _API_DOCS_entryConfig_isValid, _API_DOCS_entryConfig, _API_DOCS_entryConfig_options;
                // Hovering the value of the config
                const text = (0, _utils.removeStringQuotes)(value.getText());
                const key = isString ? `"${text}"` : text;
                const isValid = API_DOCS[entryConfig].isValid ? (_API_DOCS_entryConfig_isValid = (_API_DOCS_entryConfig = API_DOCS[entryConfig]).isValid) == null ? void 0 : _API_DOCS_entryConfig_isValid.call(_API_DOCS_entryConfig, key) : !!((_API_DOCS_entryConfig_options = API_DOCS[entryConfig].options) == null ? void 0 : _API_DOCS_entryConfig_options[key]);
                if (isValid) {
                    var _API_DOCS_entryConfig_options1, _API_DOCS_entryConfig_getHint, _API_DOCS_entryConfig1;
                    overridden = {
                        kind: ts.ScriptElementKind.enumElement,
                        kindModifiers: ts.ScriptElementKindModifier.none,
                        textSpan: {
                            start: value.getStart(),
                            length: value.getWidth()
                        },
                        displayParts: [],
                        documentation: [
                            {
                                kind: 'text',
                                text: ((_API_DOCS_entryConfig_options1 = API_DOCS[entryConfig].options) == null ? void 0 : _API_DOCS_entryConfig_options1[key]) || ((_API_DOCS_entryConfig_getHint = (_API_DOCS_entryConfig1 = API_DOCS[entryConfig]).getHint) == null ? void 0 : _API_DOCS_entryConfig_getHint.call(_API_DOCS_entryConfig1, key)) || ''
                            },
                            docsLink
                        ]
                    };
                } else {
                    // Wrong value: still show the docs link, and when available, the
                    // inferred type for non-literal (i.e. non-direct) exports.
                    overridden = {
                        kind: ts.ScriptElementKind.enumElement,
                        kindModifiers: ts.ScriptElementKindModifier.none,
                        textSpan: {
                            start: value.getStart(),
                            length: value.getWidth()
                        },
                        displayParts,
                        documentation: [
                            docsLink
                        ]
                    };
                }
            } else {
                // For function-valued configs, if we're hovering anywhere within the
                // initializer (including `async`, parameters, or the body) but not on
                // the export identifier itself, don't override TypeScript's default
                // hover. We only want to override when hovering the config identifier
                // (e.g. `generateMetadata`), not arbitrary tokens within the function.
                if (isFunctionValue && (0, _utils.isPositionInsideNode)(position, value) && // hover is somewhere within the function initializer
                !(0, _utils.isPositionInsideNode)(position, name) // ...but not on the export identifier itself
                ) {
                    return;
                }
                // Hovers the name of the config
                overridden = {
                    kind: ts.ScriptElementKind.enumElement,
                    kindModifiers: ts.ScriptElementKindModifier.none,
                    textSpan: {
                        start: name.getStart(),
                        length: name.getWidth()
                    },
                    displayParts,
                    documentation: [
                        {
                            kind: 'text',
                            text: getAPIDescription(entryConfig)
                        },
                        docsLink
                    ]
                };
            }
        });
        return overridden;
    },
    // Show details on the side when auto completing.
    getCompletionEntryDetails (entryName, data, fileName) {
        const ts = (0, _utils.getTs)();
        if (data && data.moduleSpecifier && data.moduleSpecifier.startsWith('next/typescript')) {
            let content = '';
            if (data.moduleSpecifier === 'next/typescript/entry_option_name') {
                content = getAPIDescription(entryName);
            } else {
                const options = API_DOCS[data.exportName].options;
                if (!options) return;
                content = options[entryName];
            }
            if (entryName === 'metadata' || entryName === 'generateMetadata') {
                const sourceFile = (0, _utils.getSource)(fileName);
                let start = 0;
                let foundMetadataImport = false;
                if (sourceFile) {
                    const visitor = (node)=>{
                        // Check for top directive
                        if (ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression) && node.expression.getStart() === 0) {
                            const text = node.expression.text;
                            if (text.startsWith('use ')) {
                                start = node.end + 1;
                                return node // Continue traversal
                                ;
                            }
                        }
                        // Check for Metadata import
                        if (ts.isImportDeclaration(node) && (node.moduleSpecifier.getText() === '"next"' || node.moduleSpecifier.getText() === "'next'")) {
                            var _node_importClause;
                            const namedImports = (_node_importClause = node.importClause) == null ? void 0 : _node_importClause.namedBindings;
                            if (namedImports && ts.isNamedImports(namedImports)) {
                                foundMetadataImport = namedImports.elements.some((element)=>{
                                    var _element_propertyName;
                                    const name = element.name.getText();
                                    const propertyName = (_element_propertyName = element.propertyName) == null ? void 0 : _element_propertyName.getText();
                                    return name === 'Metadata' || propertyName === 'Metadata';
                                });
                                if (foundMetadataImport) {
                                    return; // Stop traversal
                                }
                            }
                        }
                        return node;
                    };
                    for (const statement of sourceFile.statements){
                        if (foundMetadataImport) break;
                        ts.visitNode(statement, visitor);
                    }
                }
                return {
                    name: entryName,
                    kind: ts.ScriptElementKind.enumElement,
                    kindModifiers: ts.ScriptElementKindModifier.none,
                    displayParts: [],
                    codeActions: foundMetadataImport ? undefined : [
                        {
                            description: `Import type 'Metadata' from module 'next'`,
                            changes: [
                                {
                                    fileName,
                                    textChanges: [
                                        {
                                            span: {
                                                start,
                                                length: 0
                                            },
                                            newText: `import type { Metadata } from 'next';\n`
                                        }
                                    ]
                                }
                            ]
                        }
                    ],
                    documentation: [
                        {
                            kind: 'text',
                            text: content
                        }
                    ]
                };
            }
            return {
                name: entryName,
                kind: ts.ScriptElementKind.enumElement,
                kindModifiers: ts.ScriptElementKindModifier.none,
                displayParts: [],
                documentation: [
                    {
                        kind: 'text',
                        text: content
                    }
                ]
            };
        }
    },
    // Show errors for invalid export fields.
    getSemanticDiagnosticsForExportVariableStatement (source, node) {
        const ts = (0, _utils.getTs)();
        const diagnostics = [];
        // Check if it has correct option exports
        if (ts.isVariableDeclarationList(node.declarationList)) {
            for (const declaration of node.declarationList.declarations){
                const name = declaration.name;
                if (ts.isIdentifier(name)) {
                    if (!_constant.ALLOWED_EXPORTS.includes(name.text) && !API_DOCS[name.text]) {
                        diagnostics.push({
                            file: source,
                            category: ts.DiagnosticCategory.Error,
                            code: _constant.NEXT_TS_ERRORS.INVALID_ENTRY_EXPORT,
                            messageText: `"${name.text}" is not a valid Next.js entry export value.`,
                            start: name.getStart(),
                            length: name.getWidth()
                        });
                    } else if (API_DOCS[name.text]) {
                        // Check if the value is valid
                        const value = declaration.initializer;
                        const options = API_DOCS[name.text].options;
                        if (value && options) {
                            let displayedValue = '';
                            let errorMessage = '';
                            let isInvalid = false;
                            if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
                                var _API_DOCS_name_text_isValid, _API_DOCS_name_text;
                                const val = '"' + (0, _utils.removeStringQuotes)(value.getText()) + '"';
                                const allowedValues = Object.keys(options).filter((v)=>/^['"]/.test(v));
                                if (!allowedValues.includes(val) && !((_API_DOCS_name_text_isValid = (_API_DOCS_name_text = API_DOCS[name.text]).isValid) == null ? void 0 : _API_DOCS_name_text_isValid.call(_API_DOCS_name_text, val))) {
                                    isInvalid = true;
                                    displayedValue = val;
                                }
                            } else if (ts.isNumericLiteral(value) || ts.isPrefixUnaryExpression(value) && ts.isMinusToken(value.operator) && (ts.isNumericLiteral(value.operand.kind) || ts.isIdentifier(value.operand.kind) && value.operand.kind.getText() === 'Infinity') || ts.isIdentifier(value) && value.getText() === 'Infinity') {
                                var _API_DOCS_name_text_isValid1, _API_DOCS_name_text1;
                                const v = value.getText();
                                if (!((_API_DOCS_name_text_isValid1 = (_API_DOCS_name_text1 = API_DOCS[name.text]).isValid) == null ? void 0 : _API_DOCS_name_text_isValid1.call(_API_DOCS_name_text1, v))) {
                                    isInvalid = true;
                                    displayedValue = v;
                                }
                            } else if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) {
                                var _API_DOCS_name_text_isValid2, _API_DOCS_name_text2;
                                const v = value.getText();
                                if (!((_API_DOCS_name_text_isValid2 = (_API_DOCS_name_text2 = API_DOCS[name.text]).isValid) == null ? void 0 : _API_DOCS_name_text_isValid2.call(_API_DOCS_name_text2, v))) {
                                    isInvalid = true;
                                    displayedValue = v;
                                }
                            } else if (ts.isArrayLiteralExpression(value)) {
                                var _API_DOCS_name_text_isValid3, _API_DOCS_name_text3;
                                const v = value.getText();
                                if (!((_API_DOCS_name_text_isValid3 = (_API_DOCS_name_text3 = API_DOCS[name.text]).isValid) == null ? void 0 : _API_DOCS_name_text_isValid3.call(_API_DOCS_name_text3, JSON.stringify(value.elements.map((e)=>e.getText()))))) {
                                    isInvalid = true;
                                    displayedValue = v;
                                }
                            } else if (// Other literals
                            ts.isBigIntLiteral(value) || ts.isObjectLiteralExpression(value) || ts.isRegularExpressionLiteral(value) || ts.isPrefixUnaryExpression(value)) {
                                isInvalid = true;
                                displayedValue = value.getText();
                            } else {
                                // Not a literal, error because it's not statically analyzable
                                isInvalid = true;
                                displayedValue = value.getText();
                                errorMessage = `"${displayedValue}" is not a valid value for the "${name.text}" option. The configuration must be statically analyzable.`;
                            }
                            if (isInvalid) {
                                diagnostics.push({
                                    file: source,
                                    category: ts.DiagnosticCategory.Error,
                                    code: _constant.NEXT_TS_ERRORS.INVALID_OPTION_VALUE,
                                    messageText: errorMessage || `"${displayedValue}" is not a valid value for the "${name.text}" option.`,
                                    start: value.getStart(),
                                    length: value.getWidth()
                                });
                            }
                        }
                    }
                }
            }
        }
        return diagnostics;
    }
};
const _default = config;

//# sourceMappingURL=config.js.map