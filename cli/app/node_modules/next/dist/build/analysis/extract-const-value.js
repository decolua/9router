"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "extractExportedConstValue", {
    enumerable: true,
    get: function() {
        return extractExportedConstValue;
    }
});
function isExportDeclaration(node) {
    return node.type === 'ExportDeclaration';
}
function isVariableDeclaration(node) {
    return node.type === 'VariableDeclaration';
}
function isIdentifier(node) {
    return node.type === 'Identifier';
}
function isBooleanLiteral(node) {
    return node.type === 'BooleanLiteral';
}
function isNullLiteral(node) {
    return node.type === 'NullLiteral';
}
function isStringLiteral(node) {
    return node.type === 'StringLiteral';
}
function isNumericLiteral(node) {
    return node.type === 'NumericLiteral';
}
function isArrayExpression(node) {
    return node.type === 'ArrayExpression';
}
function isObjectExpression(node) {
    return node.type === 'ObjectExpression';
}
function isKeyValueProperty(node) {
    return node.type === 'KeyValueProperty';
}
function isRegExpLiteral(node) {
    return node.type === 'RegExpLiteral';
}
function isTemplateLiteral(node) {
    return node.type === 'TemplateLiteral';
}
function isTsSatisfiesExpression(node) {
    return node.type === 'TsSatisfiesExpression';
}
/** Formats a path array like `["config", "runtime", "[0]", "value"]` → `"config.runtime[0].value"` */ function formatCodePath(paths) {
    if (!paths) return undefined;
    let codePath = '';
    for (const path of paths){
        if (path[0] === '[') {
            // "array" + "[0]"
            codePath += path;
        } else if (codePath === '') {
            codePath = path;
        } else {
            // "object" + ".key"
            codePath += `.${path}`;
        }
    }
    return codePath;
}
function extractValue(node, path) {
    if (isNullLiteral(node)) {
        return {
            value: null
        };
    } else if (isBooleanLiteral(node)) {
        // e.g. true / false
        return {
            value: node.value
        };
    } else if (isStringLiteral(node)) {
        // e.g. "abc"
        return {
            value: node.value
        };
    } else if (isNumericLiteral(node)) {
        // e.g. 123
        return {
            value: node.value
        };
    } else if (isRegExpLiteral(node)) {
        // e.g. /abc/i
        return {
            value: new RegExp(node.pattern, node.flags)
        };
    } else if (isIdentifier(node)) {
        switch(node.value){
            case 'undefined':
                return {
                    value: undefined
                };
            default:
                return {
                    unsupported: `Unknown identifier "${node.value}"`,
                    path: formatCodePath(path)
                };
        }
    } else if (isArrayExpression(node)) {
        // e.g. [1, 2, 3]
        const arr = [];
        for(let i = 0, len = node.elements.length; i < len; i++){
            const elem = node.elements[i];
            if (elem) {
                if (elem.spread) {
                    // e.g. [ ...a ]
                    return {
                        unsupported: 'Unsupported spread operator in the Array Expression',
                        path: formatCodePath(path)
                    };
                }
                const result = extractValue(elem.expression, path && [
                    ...path,
                    `[${i}]`
                ]);
                if ('unsupported' in result) return result;
                arr.push(result.value);
            } else {
                // e.g. [1, , 2]
                //         ^^
                arr.push(undefined);
            }
        }
        return {
            value: arr
        };
    } else if (isObjectExpression(node)) {
        // e.g. { a: 1, b: 2 }
        const obj = {};
        for (const prop of node.properties){
            if (!isKeyValueProperty(prop)) {
                // e.g. { ...a }
                return {
                    unsupported: 'Unsupported spread operator in the Object Expression',
                    path: formatCodePath(path)
                };
            }
            let key;
            if (isIdentifier(prop.key)) {
                // e.g. { a: 1, b: 2 }
                key = prop.key.value;
            } else if (isStringLiteral(prop.key)) {
                // e.g. { "a": 1, "b": 2 }
                key = prop.key.value;
            } else {
                return {
                    unsupported: `Unsupported key type "${prop.key.type}" in the Object Expression`,
                    path: formatCodePath(path)
                };
            }
            const result = extractValue(prop.value, path && [
                ...path,
                key
            ]);
            if ('unsupported' in result) return result;
            obj[key] = result.value;
        }
        return {
            value: obj
        };
    } else if (isTemplateLiteral(node)) {
        // e.g. `abc`
        if (node.expressions.length !== 0) {
            // TODO: should we add support for `${'e'}d${'g'}'e'`?
            return {
                unsupported: 'Unsupported template literal with expressions',
                path: formatCodePath(path)
            };
        }
        // When TemplateLiteral has 0 expressions, the length of quasis is always 1.
        // Because when parsing TemplateLiteral, the parser yields the first quasi,
        // then the first expression, then the next quasi, then the next expression, etc.,
        // until the last quasi.
        // Thus if there is no expression, the parser ends at the frst and also last quasis
        //
        // A "cooked" interpretation where backslashes have special meaning, while a
        // "raw" interpretation where backslashes do not have special meaning
        // https://exploringjs.com/impatient-js/ch_template-literals.html#template-strings-cooked-vs-raw
        const [{ cooked, raw }] = node.quasis;
        return {
            value: cooked ?? raw
        };
    } else if (isTsSatisfiesExpression(node)) {
        return extractValue(node.expression);
    } else {
        return {
            unsupported: `Unsupported node type "${node.type}"`,
            path: formatCodePath(path)
        };
    }
}
function extractExportedConstValue(module, exportedName) {
    if (!module) return null;
    for (const moduleItem of module.body){
        if (!isExportDeclaration(moduleItem)) {
            continue;
        }
        const declaration = moduleItem.declaration;
        if (!isVariableDeclaration(declaration)) {
            continue;
        }
        if (declaration.kind !== 'const') {
            continue;
        }
        for (const decl of declaration.declarations){
            if (isIdentifier(decl.id) && decl.id.value === exportedName && decl.init) {
                return extractValue(decl.init, [
                    exportedName
                ]);
            }
        }
    }
    return null;
}

//# sourceMappingURL=extract-const-value.js.map