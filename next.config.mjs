import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));
// Stamp the build with the revision and the release it was made from. A deploy
// that ships without .git history still knows what it is, so the update banner can
// compare it against the repository instead of staying silent forever.
function stampBuild() {
  const stamp = {};
  try {
    stamp.APP_REVISION = process.env.APP_REVISION
      || execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    // Built outside a checkout: the release heading is the only anchor left.
  }
  try {
    const changelog = readFileSync(join(projectRoot, "CHANGELOG.md"), "utf8");
    const heading = changelog.match(/^#\s+(v[0-9][^\s(]*)/m);
    if (heading) stamp.APP_RELEASE = process.env.APP_RELEASE || heading[1].trim();
  } catch {
    // No changelog in the build context: the release signal stays unknown.
  }
  return stamp;
}
// CLI bundling needs workspace root so tracing includes hoisted node_modules (slim ~50MB).
// Docker / default uses projectRoot so server.js lands at /app/server.js (not nested).
const tracingRoot = process.env.NEXT_TRACING_ROOT_MODE === "workspace"
  ? join(projectRoot, "..")
  : projectRoot;
const proxyClientMaxBodySize = process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE || "128mb";

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  // `open` must stay external. It derives its own directory from `import.meta.url`, and
  // webpack replaces that with the absolute path of the BUILD machine as a string literal.
  // A release built on macOS therefore ships `file:///Users/.../open/index.js`, which
  // `fileURLToPath` rejects on Windows ("File URL path must be absolute" — no drive
  // letter). That throw happens at module scope, so every consumer of `open` dies on
  // import — including xAI/Grok token refresh, which loads the OAuth service that imports
  // it. Keeping it external preserves the real `import.meta.url` at runtime.
  serverExternalPackages: ["better-sqlite3", "sql.js", "node:sqlite", "bun:sqlite", "open"],
  turbopack: {
    root: tracingRoot
  },
  images: {
    unoptimized: true
  },
  env: stampBuild(),
  experimental: {
    // Next 14 reads tracing keys here (top-level is Next 15+ and ignored with a
    // warning). #4: also exclude Windows user-profile junctions (EPERM scandir
    // AppData/Local/Application Data) plus roaming/config caches from NFT tracing.
    outputFileTracingRoot: tracingRoot,
    outputFileTracingExcludes: {
      "*": [
        "./gitbook/**/*",
        "**/AppData/Local/**/*",
        "**/AppData/Roaming/**/*",
        "**/.config/**/*",
        "**/.codex/**/*",
        "**/Cookies/**/*",
      ],
    },
    // Next 14 reads this key (top-level serverExternalPackages is Next 15+ and
    // ignored with a warning). Keep both so the db adapters stay external.
    serverComponentsExternalPackages: ["better-sqlite3", "sql.js", "node:sqlite", "bun:sqlite", "open"],
    // #1529/#1572: LLM clients can send long context or base64 image payloads through /v1 rewrites.
    proxyClientMaxBodySize,
    // Cache fetch responses across HMR refreshes for faster dev reloads.
    serverComponentsHmrCache: true,
    // Tree-shake heavy barrel imports to cut compile + bundle size
    optimizePackageImports: ["@xyflow/react", "@dnd-kit/core", "@dnd-kit/sortable", "material-symbols", "marked"],
  },
  webpack: (config, { isServer }) => {
    // Ignore fs/path modules in browser bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    // Exclude non-source dirs from watcher to reduce inotify load
    config.watchOptions = {
      ...config.watchOptions,
      aggregateTimeout: 300,
      ignored: /[\\/](node_modules|\.git|logs|\.next|\.next-cli-build|gitbook|cli|open-sse\.old|tests|docs)[\\/]/,
    };
    // Defense in depth: bun:sqlite is never used on Node 22 runners, and the
    // runtime import is already guarded + dynamic — keep it out of the bundle.
    if (isServer) {
      config.externals = config.externals || [];
      if (!config.externals.includes("bun:sqlite")) config.externals.push("bun:sqlite");
    }
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/v1/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1/v1",
        destination: "/api/v1"
      },
      {
        source: "/codex/:path*",
        destination: "/api/v1/responses"
      },
      {
        source: "/responses",
        destination: "/api/v1/responses"
      },
      {
        source: "/systemone",
        destination: "/api/v1/systemone"
      },
      {
        source: "/v1beta/:path*",
        destination: "/api/v1beta/:path*"
      },
      {
        source: "/v1beta",
        destination: "/api/v1beta"
      },
      {
        source: "/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1",
        destination: "/api/v1"
      }
    ];
  }
};

export default nextConfig;
