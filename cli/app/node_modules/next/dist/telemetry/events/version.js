"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "eventCliSession", {
    enumerable: true,
    get: function() {
        return eventCliSession;
    }
});
const EVENT_VERSION = 'NEXT_CLI_SESSION_STARTED';
function eventCliSession(nextConfig, event) {
    var _nextConfig_experimental_staleTimes, _nextConfig_experimental_staleTimes1, _nextConfig_reactCompiler, _nextConfig_reactCompiler1;
    // This should be an invariant, if it fails our build tooling is broken.
    if (typeof "16.2.1" !== 'string') {
        return [];
    }
    const { images, i18n } = nextConfig || {};
    const payload = {
        nextVersion: "16.2.1",
        nodeVersion: process.version,
        cliCommand: event.cliCommand,
        isSrcDir: event.isSrcDir,
        hasNowJson: event.hasNowJson,
        isCustomServer: event.isCustomServer,
        hasNextConfig: nextConfig.configOrigin !== 'default',
        buildTarget: 'default',
        hasWebpackConfig: typeof (nextConfig == null ? void 0 : nextConfig.webpack) === 'function',
        hasBabelConfig: false,
        imageEnabled: !!images,
        imageFutureEnabled: !!images,
        basePathEnabled: !!(nextConfig == null ? void 0 : nextConfig.basePath),
        i18nEnabled: !!i18n,
        locales: (i18n == null ? void 0 : i18n.locales) ? i18n.locales.join(',') : null,
        localeDomainsCount: (i18n == null ? void 0 : i18n.domains) ? i18n.domains.length : null,
        localeDetectionEnabled: !i18n ? null : i18n.localeDetection !== false,
        imageDomainsCount: (images == null ? void 0 : images.domains) ? images.domains.length : null,
        imageRemotePatternsCount: (images == null ? void 0 : images.remotePatterns) ? images.remotePatterns.length : null,
        imageLocalPatternsCount: (images == null ? void 0 : images.localPatterns) ? images.localPatterns.length : null,
        imageSizes: (images == null ? void 0 : images.imageSizes) ? images.imageSizes.join(',') : null,
        imageQualities: (images == null ? void 0 : images.qualities) ? images.qualities.join(',') : null,
        imageLoader: images == null ? void 0 : images.loader,
        imageFormats: (images == null ? void 0 : images.formats) ? images.formats.join(',') : null,
        nextConfigOutput: (nextConfig == null ? void 0 : nextConfig.output) || null,
        trailingSlashEnabled: !!(nextConfig == null ? void 0 : nextConfig.trailingSlash),
        reactStrictMode: !!(nextConfig == null ? void 0 : nextConfig.reactStrictMode),
        webpackVersion: event.webpackVersion || null,
        turboFlag: event.turboFlag || false,
        isRspack: process.env.NEXT_RSPACK !== undefined,
        appDir: event.appDir,
        pagesDir: event.pagesDir,
        staticStaleTime: ((_nextConfig_experimental_staleTimes = nextConfig.experimental.staleTimes) == null ? void 0 : _nextConfig_experimental_staleTimes.static) ?? null,
        dynamicStaleTime: ((_nextConfig_experimental_staleTimes1 = nextConfig.experimental.staleTimes) == null ? void 0 : _nextConfig_experimental_staleTimes1.dynamic) ?? null,
        reactCompiler: Boolean(nextConfig.reactCompiler),
        reactCompilerCompilationMode: typeof nextConfig.reactCompiler !== 'boolean' ? ((_nextConfig_reactCompiler = nextConfig.reactCompiler) == null ? void 0 : _nextConfig_reactCompiler.compilationMode) ?? null : null,
        reactCompilerPanicThreshold: typeof nextConfig.reactCompiler !== 'boolean' ? ((_nextConfig_reactCompiler1 = nextConfig.reactCompiler) == null ? void 0 : _nextConfig_reactCompiler1.panicThreshold) ?? null : null
    };
    return [
        {
            eventName: EVENT_VERSION,
            payload
        }
    ];
}

//# sourceMappingURL=version.js.map