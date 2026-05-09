"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    handlePageMetadataResponse: null,
    registerGetPageMetadataTool: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    handlePageMetadataResponse: function() {
        return handlePageMetadataResponse;
    },
    registerGetPageMetadataTool: function() {
        return registerGetPageMetadataTool;
    }
});
const _hotreloadertypes = require("../../dev/hot-reloader-types");
const _browsercommunication = require("./utils/browser-communication");
const _mcptelemetrytracker = require("../mcp-telemetry-tracker");
function registerGetPageMetadataTool(server, sendHmrMessage, getActiveConnectionCount) {
    server.registerTool('get_page_metadata', {
        description: 'Get runtime metadata about what contributes to the current page render from active browser sessions.',
        inputSchema: {}
    }, async (_request)=>{
        // Track telemetry
        _mcptelemetrytracker.mcpTelemetryTracker.recordToolCall('mcp/get_page_metadata');
        try {
            const connectionCount = getActiveConnectionCount();
            if (connectionCount === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                error: 'No browser sessions connected. Please open your application in a browser to retrieve page metadata.'
                            })
                        }
                    ]
                };
            }
            const responses = await (0, _browsercommunication.createBrowserRequest)(_hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.REQUEST_PAGE_METADATA, sendHmrMessage, getActiveConnectionCount, _browsercommunication.DEFAULT_BROWSER_REQUEST_TIMEOUT_MS);
            if (responses.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                sessions: []
                            })
                        }
                    ]
                };
            }
            const sessionMetadata = [];
            for (const response of responses){
                if (response.data) {
                    // TODO: Add other metadata for the current page render here. Currently, we only have segment trie data.
                    const pageMetadata = convertSegmentTrieToPageMetadata(response.data);
                    sessionMetadata.push({
                        url: response.url,
                        metadata: pageMetadata
                    });
                }
            }
            if (sessionMetadata.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                sessions: []
                            })
                        }
                    ]
                };
            }
            const output = formatPageMetadata(sessionMetadata);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(output)
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
function handlePageMetadataResponse(requestId, segmentTrieData, url) {
    (0, _browsercommunication.handleBrowserPageResponse)(requestId, segmentTrieData, url || '');
}
function convertSegmentTrieToPageMetadata(data) {
    const segments = [];
    if (data.segmentTrie) {
        // Traverse the trie and collect all segments
        function traverseTrie(node) {
            if (node.value) {
                segments.push({
                    type: node.value.type,
                    pagePath: node.value.pagePath,
                    boundaryType: node.value.boundaryType
                });
            }
            for (const childNode of Object.values(node.children)){
                if (childNode) {
                    traverseTrie(childNode);
                }
            }
        }
        traverseTrie(data.segmentTrie);
    }
    return {
        segments,
        routerType: data.routerType
    };
}
function formatPageMetadata(sessionMetadata) {
    const sessions = [];
    for (const { url, metadata } of sessionMetadata){
        let displayUrl = url;
        try {
            const urlObj = new URL(url);
            displayUrl = urlObj.pathname + urlObj.search + urlObj.hash;
        } catch  {
        // If URL parsing fails, use the original URL
        }
        // Ensure consistent output to avoid flaky tests
        const sortedSegments = [
            ...metadata.segments
        ].sort((a, b)=>{
            const typeOrder = (segment)=>{
                const type = segment.boundaryType || segment.type;
                if (type === 'layout') return 0;
                if (type.startsWith('boundary:')) return 1;
                if (type === 'page') return 2;
                return 3;
            };
            const aOrder = typeOrder(a);
            const bOrder = typeOrder(b);
            if (aOrder !== bOrder) return aOrder - bOrder;
            return a.pagePath.localeCompare(b.pagePath);
        });
        const formattedSegments = [];
        for (const segment of sortedSegments){
            const path = segment.pagePath;
            const isBuiltin = path.startsWith('__next_builtin__');
            const type = segment.boundaryType || segment.type;
            const isBoundary = type.startsWith('boundary:');
            let displayPath = path.replace(/@boundary$/, '').replace(/^__next_builtin__/, '');
            if (!isBuiltin && !displayPath.startsWith('app/')) {
                displayPath = `app/${displayPath}`;
            }
            formattedSegments.push({
                path: displayPath,
                type,
                isBoundary,
                isBuiltin
            });
        }
        sessions.push({
            url: displayUrl,
            routerType: metadata.routerType,
            segments: formattedSegments
        });
    }
    return {
        sessions
    };
}

//# sourceMappingURL=get-page-metadata.js.map