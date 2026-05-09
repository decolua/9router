"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getMcpMiddleware", {
    enumerable: true,
    get: function() {
        return getMcpMiddleware;
    }
});
const _getorcreatemcpserver = require("./get-or-create-mcp-server");
const _parsebody = require("../api-utils/node/parse-body");
const _streamableHttp = require("next/dist/compiled/@modelcontextprotocol/sdk/server/streamableHttp");
function getMcpMiddleware(options) {
    return async function(req, res, next) {
        const { pathname } = new URL(req.url || '', 'http://n');
        if (!pathname.startsWith('/_next/mcp')) {
            return next();
        }
        const mcpServer = (0, _getorcreatemcpserver.getOrCreateMcpServer)(options);
        const transport = new _streamableHttp.StreamableHTTPServerTransport({
            sessionIdGenerator: undefined
        });
        try {
            res.on('close', ()=>{
                transport.close();
            });
            await mcpServer.connect(transport);
            const parsedBody = await (0, _parsebody.parseBody)(req, 1024 * 1024) // 1MB limit
            ;
            await transport.handleRequest(req, res, parsedBody);
        } catch (error) {
            if (!res.headersSent) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    error: {
                        code: -32000,
                        message: 'Internal server error'
                    },
                    id: null
                }));
            }
        }
    };
}

//# sourceMappingURL=get-mcp-middleware.js.map