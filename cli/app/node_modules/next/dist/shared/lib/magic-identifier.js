"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    MAGIC_IDENTIFIER_REGEX: null,
    decodeMagicIdentifier: null,
    deobfuscateModuleId: null,
    deobfuscateText: null,
    deobfuscateTextParts: null,
    removeFreeCallWrapper: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    MAGIC_IDENTIFIER_REGEX: function() {
        return MAGIC_IDENTIFIER_REGEX;
    },
    decodeMagicIdentifier: function() {
        return decodeMagicIdentifier;
    },
    deobfuscateModuleId: function() {
        return deobfuscateModuleId;
    },
    deobfuscateText: function() {
        return deobfuscateText;
    },
    deobfuscateTextParts: function() {
        return deobfuscateTextParts;
    },
    removeFreeCallWrapper: function() {
        return removeFreeCallWrapper;
    }
});
function decodeHex(hexStr) {
    if (hexStr.trim() === '') {
        throw Object.defineProperty(new Error("can't decode empty hex"), "__NEXT_ERROR_CODE", {
            value: "E19",
            enumerable: false,
            configurable: true
        });
    }
    const num = parseInt(hexStr, 16);
    if (isNaN(num)) {
        throw Object.defineProperty(new Error(`invalid hex: \`${hexStr}\``), "__NEXT_ERROR_CODE", {
            value: "E293",
            enumerable: false,
            configurable: true
        });
    }
    return String.fromCodePoint(num);
}
const DECODE_REGEX = /^__TURBOPACK__([a-zA-Z0-9_$]+)__$/;
function decodeMagicIdentifier(identifier) {
    const matches = identifier.match(DECODE_REGEX);
    if (!matches) {
        return identifier;
    }
    const inner = matches[1];
    let output = '';
    let mode = 0;
    let buffer = '';
    for(let i = 0; i < inner.length; i++){
        const char = inner[i];
        if (mode === 0) {
            if (char === '_') {
                mode = 1;
            } else if (char === '$') {
                mode = 2;
            } else {
                output += char;
            }
        } else if (mode === 1) {
            if (char === '_') {
                output += ' ';
                mode = 0;
            } else if (char === '$') {
                output += '_';
                mode = 2;
            } else {
                output += char;
                mode = 0;
            }
        } else if (mode === 2) {
            if (buffer.length === 2) {
                output += decodeHex(buffer);
                buffer = '';
            }
            if (char === '_') {
                if (buffer !== '') {
                    throw Object.defineProperty(new Error(`invalid hex: \`${buffer}\``), "__NEXT_ERROR_CODE", {
                        value: "E1022",
                        enumerable: false,
                        configurable: true
                    });
                }
                mode = 3;
            } else if (char === '$') {
                if (buffer !== '') {
                    throw Object.defineProperty(new Error(`invalid hex: \`${buffer}\``), "__NEXT_ERROR_CODE", {
                        value: "E1022",
                        enumerable: false,
                        configurable: true
                    });
                }
                mode = 0;
            } else {
                buffer += char;
            }
        } else if (mode === 3) {
            if (char === '_') {
                throw Object.defineProperty(new Error(`invalid hex: \`${buffer + char}\``), "__NEXT_ERROR_CODE", {
                    value: "E293",
                    enumerable: false,
                    configurable: true
                });
            } else if (char === '$') {
                output += decodeHex(buffer);
                buffer = '';
                mode = 0;
            } else {
                buffer += char;
            }
        }
    }
    return output;
}
const MAGIC_IDENTIFIER_REGEX = /__TURBOPACK__[a-zA-Z0-9_$]+__/g;
function deobfuscateModuleId(moduleId) {
    return moduleId// Replace [project] with .
    .replace(/\[project\]/g, '.')// Remove content in square brackets (e.g. [app-rsc])
    .replace(/\s\[([^\]]*)\]/g, '')// Remove content in parentheses (e.g. (ecmascript))
    .replace(/\s\(([^)]*)\)/g, '')// Remove content in angle brackets (e.g. <locals>)
    .replace(/\s<([^>]*)>/g, '')// Clean up any extra whitespace
    .trim();
}
function removeFreeCallWrapper(text) {
    // Match (0, <ident>.<ident>) patterns anywhere in the text the beginning
    // Overzealous: accept any non-whitespace member expression after the dot.
    // TODO: Fix https://linear.app/vercel/issue/NEXT-4875 to allow using unicode property escapes
    return text.replace(/\(0\s*,\s*(__TURBOPACK__[a-zA-Z0-9_$]+__\.[^\s)]+)\)/g, '$1');
}
function deobfuscateTextParts(text) {
    // First, remove free call wrappers
    const withoutFreeCall = removeFreeCallWrapper(text);
    const parts = [];
    let lastIndex = 0;
    // Create a new regex instance for global matching
    const regex = new RegExp(MAGIC_IDENTIFIER_REGEX.source, 'g');
    for(let match = regex.exec(withoutFreeCall); match !== null; match = regex.exec(withoutFreeCall)){
        const matchStart = match.index;
        const matchEnd = regex.lastIndex;
        const ident = match[0];
        // Add raw text before this match (if any)
        if (matchStart > lastIndex) {
            const rawText = withoutFreeCall.substring(lastIndex, matchStart);
            parts.push([
                'raw',
                rawText
            ]);
        }
        // Process and add the deobfuscated part
        try {
            const decoded = decodeMagicIdentifier(ident);
            // If it was a magic identifier, clean up the module ID
            if (decoded !== ident) {
                // Check if this is an "imported module" reference
                const importedModuleMatch = decoded.match(/^imported module (.+)$/);
                if (importedModuleMatch) {
                    // Clean the entire module path (which includes [app-rsc], etc.)
                    const modulePathWithMetadata = importedModuleMatch[1];
                    const cleaned = deobfuscateModuleId(modulePathWithMetadata);
                    parts.push([
                        'deobfuscated',
                        `{imported module ${cleaned}}`
                    ]);
                } else {
                    const cleaned = deobfuscateModuleId(decoded);
                    parts.push([
                        'deobfuscated',
                        `{${cleaned}}`
                    ]);
                }
            } else {
                // Not actually a magic identifier, treat as raw
                parts.push([
                    'raw',
                    ident
                ]);
            }
        } catch (e) {
            parts.push([
                'deobfuscated',
                `{${ident} (decoding failed: ${e})}`
            ]);
        }
        lastIndex = matchEnd;
    }
    // Add any remaining raw text after the last match
    if (lastIndex < withoutFreeCall.length) {
        const rawText = withoutFreeCall.substring(lastIndex);
        parts.push([
            'raw',
            rawText
        ]);
    }
    return parts;
}
function deobfuscateText(text) {
    const parts = deobfuscateTextParts(text);
    return parts.map((part)=>part[1]).join('');
}

//# sourceMappingURL=magic-identifier.js.map