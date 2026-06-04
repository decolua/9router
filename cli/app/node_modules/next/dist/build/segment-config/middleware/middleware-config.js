"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    MiddlewareConfigInputSchema: null,
    MiddlewareConfigInputSchemaKeys: null,
    SourceSchema: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    MiddlewareConfigInputSchema: function() {
        return MiddlewareConfigInputSchema;
    },
    MiddlewareConfigInputSchemaKeys: function() {
        return MiddlewareConfigInputSchemaKeys;
    },
    SourceSchema: function() {
        return SourceSchema;
    }
});
const _picomatch = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/picomatch"));
const _zod = require("next/dist/compiled/zod");
const _trytoparsepath = require("../../../lib/try-to-parse-path");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const RouteHasSchema = _zod.z.discriminatedUnion('type', [
    _zod.z.object({
        type: _zod.z.enum([
            'header',
            'query',
            'cookie'
        ]),
        key: _zod.z.string({
            required_error: 'key is required when type is header, query or cookie'
        }),
        value: _zod.z.string({
            invalid_type_error: 'value must be a string'
        }).optional()
    }).strict(),
    _zod.z.object({
        type: _zod.z.literal('host'),
        value: _zod.z.string({
            required_error: 'host must have a value'
        })
    }).strict()
]);
const SourceSchema = _zod.z.string({
    required_error: 'source is required'
}).max(4096, 'exceeds max built length of 4096 for route').superRefine((val, ctx)=>{
    if (!val.startsWith('/')) {
        return ctx.addIssue({
            code: _zod.z.ZodIssueCode.custom,
            message: `source must start with /`
        });
    }
    const { error, regexStr } = (0, _trytoparsepath.tryToParsePath)(val);
    if (error || !regexStr) {
        ctx.addIssue({
            code: _zod.z.ZodIssueCode.custom,
            message: `Invalid source '${val}': ${error.message}`
        });
    }
});
const MiddlewareMatcherInputSchema = _zod.z.object({
    locale: _zod.z.union([
        _zod.z.literal(false),
        _zod.z.undefined()
    ]).optional(),
    has: _zod.z.array(RouteHasSchema).optional(),
    missing: _zod.z.array(RouteHasSchema).optional(),
    source: SourceSchema
}).strict();
const MiddlewareConfigMatcherInputSchema = _zod.z.union([
    SourceSchema,
    _zod.z.array(_zod.z.union([
        SourceSchema,
        MiddlewareMatcherInputSchema
    ], {
        invalid_type_error: 'must be an array of strings or middleware matchers'
    }))
]);
const GlobSchema = _zod.z.string().superRefine((val, ctx)=>{
    try {
        (0, _picomatch.default)(val);
    } catch (err) {
        ctx.addIssue({
            code: _zod.z.ZodIssueCode.custom,
            message: `Invalid glob pattern '${val}': ${err.message}`
        });
    }
});
const MiddlewareConfigInputSchema = _zod.z.object({
    /**
   * The matcher for the middleware.
   */ matcher: MiddlewareConfigMatcherInputSchema.optional(),
    /**
   * The regions that the middleware should run in.
   */ regions: _zod.z.union([
        _zod.z.string(),
        _zod.z.array(_zod.z.string())
    ]).optional(),
    /**
   * A glob, or an array of globs, ignoring dynamic code evaluation for specific
   * files. The globs are relative to your application root folder.
   */ unstable_allowDynamic: _zod.z.union([
        GlobSchema,
        _zod.z.array(GlobSchema)
    ]).optional()
});
const MiddlewareConfigInputSchemaKeys = MiddlewareConfigInputSchema.keyof().options;

//# sourceMappingURL=middleware-config.js.map