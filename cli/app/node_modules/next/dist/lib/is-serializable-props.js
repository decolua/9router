"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    SerializableError: null,
    isSerializableProps: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    SerializableError: function() {
        return SerializableError;
    },
    isSerializableProps: function() {
        return isSerializableProps;
    }
});
const _isplainobject = require("../shared/lib/is-plain-object");
const regexpPlainIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
class SerializableError extends Error {
    constructor(page, method, path, message){
        super(path ? `Error serializing \`${path}\` returned from \`${method}\` in "${page}".\nReason: ${message}` : `Error serializing props returned from \`${method}\` in "${page}".\nReason: ${message}`);
    }
}
function isSerializableProps(page, method, input) {
    if (!(0, _isplainobject.isPlainObject)(input)) {
        throw Object.defineProperty(new SerializableError(page, method, '', `Props must be returned as a plain object from ${method}: \`{ props: { ... } }\` (received: \`${(0, _isplainobject.getObjectClassLabel)(input)}\`).`), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
    function visit(visited, value, path) {
        if (visited.has(value)) {
            throw Object.defineProperty(new SerializableError(page, method, path, `Circular references cannot be expressed in JSON (references: \`${visited.get(value) || '(self)'}\`).`), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
        visited.set(value, path);
    }
    function isSerializable(refs, value, path) {
        const type = typeof value;
        if (// `null` can be serialized, but not `undefined`.
        value === null || // n.b. `bigint`, `function`, `symbol`, and `undefined` cannot be
        // serialized.
        //
        // `object` is special-cased below, as it may represent `null`, an Array,
        // a plain object, a class, et al.
        type === 'boolean' || type === 'number' || type === 'string') {
            return true;
        }
        if (type === 'undefined') {
            throw Object.defineProperty(new SerializableError(page, method, path, '`undefined` cannot be serialized as JSON. Please use `null` or omit this value.'), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
        if ((0, _isplainobject.isPlainObject)(value)) {
            visit(refs, value, path);
            if (Object.entries(value).every(([key, nestedValue])=>{
                const nextPath = regexpPlainIdentifier.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
                const newRefs = new Map(refs);
                return isSerializable(newRefs, key, nextPath) && isSerializable(newRefs, nestedValue, nextPath);
            })) {
                return true;
            }
            throw Object.defineProperty(new SerializableError(page, method, path, `invariant: Unknown error encountered in Object.`), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
        if (Array.isArray(value)) {
            visit(refs, value, path);
            if (value.every((nestedValue, index)=>{
                const newRefs = new Map(refs);
                return isSerializable(newRefs, nestedValue, `${path}[${index}]`);
            })) {
                return true;
            }
            throw Object.defineProperty(new SerializableError(page, method, path, `invariant: Unknown error encountered in Array.`), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
        // None of these can be expressed as JSON:
        // const type: "bigint" | "symbol" | "object" | "function"
        throw Object.defineProperty(new SerializableError(page, method, path, '`' + type + '`' + (type === 'object' ? ` ("${Object.prototype.toString.call(value)}")` : '') + ' cannot be serialized as JSON. Please only return JSON serializable data types.'), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
    return isSerializable(new Map(), input, '');
}

//# sourceMappingURL=is-serializable-props.js.map