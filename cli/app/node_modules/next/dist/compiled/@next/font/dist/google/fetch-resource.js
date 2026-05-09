"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchResource = fetchResource;
const node_http_1 = __importDefault(require("node:http"));
const node_https_1 = __importDefault(require("node:https"));
const get_proxy_agent_1 = require("./get-proxy-agent");
/**
 * Makes a simple GET request and returns the entire response as a Buffer.
 * - Throws if the response status is not 200.
 * - Applies a 3000 ms timeout when `isDev` is `true`.
 */
function fetchResource(url, isDev, errorMessage) {
    return new Promise((resolve, reject) => {
        const { protocol } = new URL(url);
        const client = protocol === 'https:' ? node_https_1.default : node_http_1.default;
        const timeout = isDev ? 3000 : undefined;
        const req = client.request(url, {
            agent: (0, get_proxy_agent_1.getProxyAgent)(),
            headers: {
                // The file format is based off of the user agent, make sure woff2 files are fetched
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
                    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                    'Chrome/104.0.0.0 Safari/537.36',
            },
        }, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(errorMessage ||
                    `Request failed: ${url} (status: ${res.statusCode})`));
                return;
            }
            const chunks = [];
            res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        if (timeout) {
            req.setTimeout(timeout, () => {
                req.destroy(new Error(`Request timed out after ${timeout}ms`));
            });
        }
        req.on('error', (err) => reject(err));
        req.end();
    });
}
