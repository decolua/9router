"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "DevAppPageNormalizer", {
    enumerable: true,
    get: function() {
        return DevAppPageNormalizer;
    }
});
const _pagetypes = require("../../../../lib/page-types");
const _absolutefilenamenormalizer = require("../../absolute-filename-normalizer");
const _normalizers = require("../../normalizers");
/**
 * DevAppPageNormalizer is a normalizer that is used to normalize a pathname
 * to a page in the `app` directory.
 */ class DevAppPageNormalizerInternal extends _absolutefilenamenormalizer.AbsoluteFilenameNormalizer {
    constructor(appDir, extensions){
        super(appDir, extensions, _pagetypes.PAGE_TYPES.APP);
    }
}
class DevAppPageNormalizer extends _normalizers.Normalizers {
    constructor(appDir, extensions, _isTurbopack){
        const normalizer = new DevAppPageNormalizerInternal(appDir, extensions);
        super(// %5F to _ replacement should only happen with Turbopack.
        // TODO: enable when page matcher `/_` check is moved: https://github.com/vercel/next.js/blob/8eda00bf5999e43e8f0211bd72c981d5ce292e8b/packages/next/src/server/route-matcher-providers/dev/dev-app-route-route-matcher-provider.ts#L48
        // isTurbopack
        //   ? [
        //       // The page should have the `%5F` characters replaced with `_` characters.
        //       new UnderscoreNormalizer(),
        //       normalizer,
        //     ]
        //   : [normalizer]
        [
            normalizer
        ]);
    }
}

//# sourceMappingURL=app-page-normalizer.js.map