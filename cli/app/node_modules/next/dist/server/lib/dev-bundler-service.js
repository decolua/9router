"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "DevBundlerService", {
    enumerable: true,
    get: function() {
        return DevBundlerService;
    }
});
const _lrucache = require("./lru-cache");
const _mockrequest = require("./mock-request");
const _hotreloadertypes = require("../dev/hot-reloader-types");
class DevBundlerService {
    constructor(bundler, handler){
        this.bundler = bundler;
        this.handler = handler;
        this.ensurePage = async (definition)=>{
            // TODO: remove after ensure is pulled out of server
            return await this.bundler.hotReloader.ensurePage(definition);
        };
        this.logErrorWithOriginalStack = this.bundler.logErrorWithOriginalStack.bind(this.bundler);
        this.appIsrManifestInner = new _lrucache.LRUCache(8000, function length() {
            return 16;
        });
        const { hotReloader } = bundler;
        this.close = hotReloader.close.bind(hotReloader);
        this.setCacheStatus = hotReloader.setCacheStatus.bind(hotReloader);
        this.setReactDebugChannel = hotReloader.setReactDebugChannel.bind(hotReloader);
        this.sendErrorsToBrowser = hotReloader.sendErrorsToBrowser.bind(hotReloader);
    }
    async getFallbackErrorComponents(url) {
        await this.bundler.hotReloader.buildFallbackError();
        // Build the error page to ensure the fallback is built too.
        // TODO: See if this can be moved into hotReloader or removed.
        await this.bundler.hotReloader.ensurePage({
            page: '/_error',
            clientOnly: false,
            definition: undefined,
            url
        });
    }
    async getCompilationError(page) {
        const errors = await this.bundler.hotReloader.getCompilationErrors(page);
        if (!errors) return;
        // Return the very first error we found.
        return errors[0];
    }
    async revalidate({ urlPath, headers, opts: revalidateOpts }) {
        const mocked = (0, _mockrequest.createRequestResponseMocks)({
            url: urlPath,
            headers
        });
        await this.handler(mocked.req, mocked.res);
        await mocked.res.hasStreamed;
        if (mocked.res.getHeader('x-nextjs-cache') !== 'REVALIDATED' && mocked.res.statusCode !== 200 && !(mocked.res.statusCode === 404 && revalidateOpts.unstable_onlyGenerated)) {
            throw Object.defineProperty(new Error(`Invalid response ${mocked.res.statusCode}`), "__NEXT_ERROR_CODE", {
                value: "E175",
                enumerable: false,
                configurable: true
            });
        }
        return {};
    }
    get appIsrManifest() {
        const serializableManifest = {};
        for (const [key, value] of this.appIsrManifestInner){
            serializableManifest[key] = value;
        }
        return serializableManifest;
    }
    setIsrStatus(key, value) {
        var // Only send the ISR manifest to legacy clients, i.e. Pages Router clients,
        // or App Router clients that have Cache Components disabled. The ISR
        // manifest is only used to inform the static indicator, which currently
        // does not provide useful information if Cache Components is enabled due to
        // its binary nature (i.e. it does not support showing info for partially
        // static pages).
        _this_bundler_hotReloader, _this_bundler;
        if (value === undefined) {
            this.appIsrManifestInner.remove(key);
        } else {
            this.appIsrManifestInner.set(key, value);
        }
        (_this_bundler = this.bundler) == null ? void 0 : (_this_bundler_hotReloader = _this_bundler.hotReloader) == null ? void 0 : _this_bundler_hotReloader.sendToLegacyClients({
            type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.ISR_MANIFEST,
            data: this.appIsrManifest
        });
    }
    sendHmrMessage(message) {
        this.bundler.hotReloader.send(message);
    }
}

//# sourceMappingURL=dev-bundler-service.js.map