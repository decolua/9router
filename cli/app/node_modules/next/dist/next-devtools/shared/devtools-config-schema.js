"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "devToolsConfigSchema", {
    enumerable: true,
    get: function() {
        return devToolsConfigSchema;
    }
});
const _zod = require("next/dist/compiled/zod");
const devToolsConfigSchema = _zod.z.object({
    theme: _zod.z.enum([
        'light',
        'dark',
        'system'
    ]).optional(),
    disableDevIndicator: _zod.z.boolean().optional(),
    devToolsPosition: _zod.z.enum([
        'top-left',
        'top-right',
        'bottom-left',
        'bottom-right'
    ]).optional(),
    devToolsPanelPosition: _zod.z.record(_zod.z.string(), _zod.z.enum([
        'top-left',
        'top-right',
        'bottom-left',
        'bottom-right'
    ])).optional(),
    devToolsPanelSize: _zod.z.record(_zod.z.string(), _zod.z.object({
        width: _zod.z.number(),
        height: _zod.z.number()
    })).optional(),
    scale: _zod.z.number().optional(),
    hideShortcut: _zod.z.string().nullable().optional()
});

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=devtools-config-schema.js.map