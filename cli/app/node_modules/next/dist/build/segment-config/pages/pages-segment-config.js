"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    PagesSegmentConfigSchemaKeys: null,
    parsePagesSegmentConfig: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    PagesSegmentConfigSchemaKeys: function() {
        return PagesSegmentConfigSchemaKeys;
    },
    parsePagesSegmentConfig: function() {
        return parsePagesSegmentConfig;
    }
});
const _zod = require("next/dist/compiled/zod");
const _zod1 = require("../../../shared/lib/zod");
/**
 * The schema for the page segment config.
 */ const PagesSegmentConfigSchema = _zod.z.object({
    /**
   * The runtime to use for the page.
   */ runtime: _zod.z.enum([
        'edge',
        'experimental-edge',
        'nodejs'
    ]).optional(),
    /**
   * The maximum duration for the page render.
   */ maxDuration: _zod.z.number().optional(),
    /**
   * The exported config object for the page.
   */ config: _zod.z.object({
        /**
       * The runtime to use for the page.
       */ runtime: _zod.z.enum([
            'edge',
            'experimental-edge',
            'nodejs'
        ]).optional(),
        /**
       * The maximum duration for the page render.
       */ maxDuration: _zod.z.number().optional()
    }).optional()
});
function parsePagesSegmentConfig(data, route) {
    const parsed = PagesSegmentConfigSchema.safeParse(data, {});
    if (!parsed.success) {
        throw (0, _zod1.formatZodError)(`Invalid segment configuration options detected for "${route}". Read more at https://nextjs.org/docs/messages/invalid-page-config`, parsed.error);
    }
    return parsed.data;
}
const PagesSegmentConfigSchemaKeys = PagesSegmentConfigSchema.keyof().options;

//# sourceMappingURL=pages-segment-config.js.map