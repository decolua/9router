/**
 * MCP tool for getting all routes that become entry points in a Next.js application.
 *
 * This tool discovers routes by scanning the filesystem directly. It finds all route
 * files in the app/ and pages/ directories and converts them to route paths.
 *
 * Returns routes grouped by router type:
 * - appRouter: App Router pages and route handlers
 * - pagesRouter: Pages Router pages and API routes
 *
 * Dynamic route segments appear as [id], [slug], or [...slug] patterns. This tool
 * does NOT expand getStaticParams - it only shows the route patterns as defined in
 * the filesystem.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "registerGetRoutesTool", {
    enumerable: true,
    get: function() {
        return registerGetRoutesTool;
    }
});
const _mcptelemetrytracker = require("../mcp-telemetry-tracker");
const _routediscovery = require("../../../build/route-discovery");
const _zod = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/zod"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function registerGetRoutesTool(server, options) {
    server.registerTool('get_routes', {
        description: 'Get all routes that will become entry points in the Next.js application by scanning the filesystem. Returns routes grouped by router type (appRouter, pagesRouter). Dynamic segments appear as [param] or [...slug] patterns. API routes are included in their respective routers (e.g., /api/* routes from pages/ are in pagesRouter). Optional parameter: routerType ("app" | "pages") - filter by specific router type, omit to get all routes.',
        inputSchema: {
            routerType: _zod.default.union([
                _zod.default.literal('app'),
                _zod.default.literal('pages')
            ]).optional()
        }
    }, async (request)=>{
        // Track telemetry
        _mcptelemetrytracker.mcpTelemetryTracker.recordToolCall('mcp/get_routes');
        try {
            const routerType = request.routerType === 'app' || request.routerType === 'pages' ? request.routerType : undefined;
            const { projectPath, nextConfig, pagesDir, appDir } = options;
            // Check if we have any directories to scan
            if (!pagesDir && !appDir) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                error: 'No pages or app directory found in the project.'
                            })
                        }
                    ]
                };
            }
            const isSrcDir = pagesDir && pagesDir.includes('/src/') || appDir && appDir.includes('/src/');
            const commonOpts = {
                pageExtensions: nextConfig.pageExtensions,
                isDev: true,
                baseDir: projectPath,
                isSrcDir: !!isSrcDir
            };
            // Discover app and pages routes independently so a failure in one
            // router doesn't prevent the other from returning results.
            let appRoutes = [];
            let pageRoutes = [];
            const wantApp = routerType !== 'pages' && appDir;
            const wantPages = routerType !== 'app' && pagesDir;
            const [appResult, pagesResult] = await Promise.all([
                wantApp ? (0, _routediscovery.discoverRoutes)({
                    ...commonOpts,
                    appDir
                }).catch(()=>null) : null,
                wantPages ? (0, _routediscovery.discoverRoutes)({
                    ...commonOpts,
                    pagesDir
                }).catch(()=>null) : null
            ]);
            if (appResult) {
                appRoutes = [
                    ...appResult.appRoutes,
                    ...appResult.appRouteHandlers
                ].map((r)=>r.route).sort();
            }
            if (pagesResult) {
                pageRoutes = [
                    ...pagesResult.pageRoutes,
                    ...pagesResult.pageApiRoutes
                ].map((r)=>r.route).sort();
            }
            if (appRoutes.length === 0 && pageRoutes.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                appRouter: [],
                                pagesRouter: []
                            })
                        }
                    ]
                };
            }
            // Format the output with grouped routes
            const output = {
                appRouter: appRoutes.length > 0 ? appRoutes : undefined,
                pagesRouter: pageRoutes.length > 0 ? pageRoutes : undefined
            };
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(output, null, 2)
                    }
                ]
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            error: error instanceof Error ? error.message : String(error)
                        })
                    }
                ]
            };
        }
    });
}

//# sourceMappingURL=get-routes.js.map