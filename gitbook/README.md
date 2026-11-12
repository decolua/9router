# 9Router documentation site

The `gitbook/` application is the static documentation site. Its Next.js configuration uses `output: "export"`, so a production build writes the deployable site to `out/`.

## Local development

From the repository root, start the documentation site with:

```bash
npm --prefix gitbook run dev
```

The `dev` script is `next dev -p 3001`; browse the local site at `http://localhost:3001`.

Build the static site with:

```bash
npm --prefix gitbook run build
```

This runs `next build` and produces `gitbook/out/`.

## Cloudflare Pages deployment

The deployment script is intentionally defined in `gitbook/package.json` as:

```bash
npm run build && npx wrangler pages deploy out --project-name=9router-docs --commit-dirty=true
```

Run it from the `gitbook/` directory with `npm run deploy`. It builds `out/` and deploys that directory to the Cloudflare Pages project named `9router-docs`. The `--commit-dirty=true` flag permits deployment from a working tree with uncommitted changes.

## Optional base path

`NEXT_PUBLIC_BASE_PATH` controls the Next.js `basePath` in `gitbook/next.config.mjs`; it defaults to an empty string when unset. When it is non-empty, the configuration assigns the same value to `assetPrefix`, so Next.js routes and emitted asset URLs are served beneath that base path. When it is unset, `assetPrefix` is undefined and the site is served from the deployment root.

For a subpath deployment, set the variable before building, for example:

```bash
NEXT_PUBLIC_BASE_PATH=/docs npm --prefix gitbook run build
```

Documentation content must keep links basePath-safe: use relative Markdown destinations between language-routed pages, and do not add root-absolute Markdown destinations or HTML `href`/`src` values beginning with `/`.
