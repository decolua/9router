import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vinext from "vinext";
import { defineConfig } from "vite";
import { injectTrustedClientIp } from "./src/lib/clientIp.js";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [
		vinext({
			// vinext appends "/app" to appDir, so point at the dir that *contains* app/.
			// "src" -> src/app. (Omitting it also works — vinext auto-detects src/app.)
			appDir: "src",
			prerender: { routes: "*" },
		}),
		{
			name: "9router:trusted-client-ip",
			configureServer(server) {
				// Dev equivalent of custom-server.js / src/lib/clientIp.js: sanitize the
				// forwarding headers and derive a trustworthy client IP from the TCP
				// socket before vinext sees the request. loginLimiter + dashboardGuard
				// read x-9r-real-ip / x-9r-via-proxy.
				server.middlewares.use((req, _res, next) => {
					try {
						injectTrustedClientIp(req);
					} catch {
						/* never block */
					}
					next();
				});
			},
		},
	],
	resolve: {
		alias: {
			// Mirror jsconfig.json path mappings so vite can resolve them.
			"@": resolve(projectRoot, "src"),
			"open-sse": resolve(projectRoot, "open-sse"),
		},
	},
	server: {
		// Exclude non-source dirs from the dev watcher to reduce inotify load
		// (port of the old next.config.mjs `webpack.watchOptions.ignored`).
		watch: {
			usePolling: false,
			ignored: [
				"**/node_modules/**",
				"**/.git/**",
				"**/logs/**",
				"**/.next/**",
				"**/.next-cli-build/**",
				"**/gitbook/**",
				"**/cli/**",
				"**/open-sse.old/**",
				"**/tests/**",
				"**/docs/**",
			],
		},
	},
});
