// Pure permission helpers, safe to import from middleware and the proxy wrapper.
// Anything that needs the request cookie lives in dashboardPermissions.js.

export const PERMISSION_KEYS = [
  "manageApiKeys",
  "manageModels",
  "manageProviders",
  "manageTools",
  "manageAdvanced",
  "managePlugins",
  "manageMediaProviders",
  "viewUsage",
];

export const DEFAULT_PERMISSIONS = {
  manageApiKeys: false,
  manageModels: false,
  manageProviders: false,
  manageTools: false,
  manageAdvanced: false,
  managePlugins: false,
  manageMediaProviders: false,
  viewUsage: true,
};

export const FULL_PERMISSIONS = {
  manageApiKeys: true,
  manageModels: true,
  manageProviders: true,
  manageTools: true,
  manageAdvanced: true,
  managePlugins: true,
  manageMediaProviders: true,
  viewUsage: true,
};

export function normalizePermissions(input) {
  const source = input && typeof input === "object" ? input : {};
  const out = {};
  for (const key of PERMISSION_KEYS) {
    out[key] = key === "viewUsage"
      ? source[key] === undefined ? DEFAULT_PERMISSIONS.viewUsage : Boolean(source[key])
      : Boolean(source[key]);
  }
  return out;
}

export function canGrantPermissions(granter, requested) {
  const have = normalizePermissions(granter);
  const want = normalizePermissions(requested);
  for (const key of PERMISSION_KEYS) {
    if (want[key] && !have[key]) return false;
  }
  return true;
}

export function clampPermissions(granter, requested) {
  const have = normalizePermissions(granter);
  const want = normalizePermissions(requested);
  const out = {};
  for (const key of PERMISSION_KEYS) out[key] = want[key] && have[key];
  return out;
}

// API surface an API key session may reach. Anything not listed is off limits, so
// a new route is closed to restricted sessions until it is named here on purpose.
// A rule without `methods` covers every method; a rule with `methods` only covers
// the ones it names, and later rules win when both match the same path.
const READ_METHODS = ["GET", "HEAD"];

const API_PERMISSION_RULES = [
  { prefix: "/api/keys", permissions: ["manageApiKeys"] },
  // The provider page needs the model catalog to render a connection, so reading it
  // is shared with manageProviders while every write stays on manageModels. Reading is
  // also shared with manageApiKeys because the key forms pick allowed models from it.
  { prefix: "/api/models/alias", permissions: ["manageModels", "manageProviders", "manageApiKeys"], methods: READ_METHODS },
  { prefix: "/api/models/disabled", permissions: ["manageModels", "manageProviders", "manageApiKeys"], methods: READ_METHODS },
  { prefix: "/api/models/availability", permissions: ["manageModels", "manageProviders", "manageApiKeys"], methods: READ_METHODS },
  { prefix: "/api/models/custom", permissions: ["manageModels", "manageProviders", "manageApiKeys"], methods: READ_METHODS },
  { prefix: "/api/model-editor", permissions: ["manageModels", "manageProviders", "manageApiKeys"], methods: READ_METHODS },
  { prefix: "/api/models", permissions: ["manageModels", "manageProviders", "manageApiKeys"], methods: READ_METHODS },
  { prefix: "/api/combos", permissions: ["manageModels", "manageProviders", "manageApiKeys"], methods: READ_METHODS },
  { prefix: "/api/tags", permissions: ["manageModels", "manageProviders", "manageApiKeys"], methods: READ_METHODS },
  { prefix: "/api/models", permissions: ["manageModels"] },
  { prefix: "/api/model-editor", permissions: ["manageModels"] },
  { prefix: "/api/combos", permissions: ["manageModels"] },
  { prefix: "/api/tags", permissions: ["manageModels"] },
  { prefix: "/api/providers", permissions: ["manageProviders"] },
  { prefix: "/api/provider-nodes", permissions: ["manageProviders"] },
  { prefix: "/api/pricing", permissions: ["manageProviders"] },
  { prefix: "/api/cli-tools", permissions: ["manageTools"] },
  { prefix: "/api/headroom", permissions: ["manageTools"] },
  { prefix: "/api/translator", permissions: ["manageAdvanced"] },
  { prefix: "/api/proxy-pools", permissions: ["manageAdvanced"] },
  { prefix: "/api/pxpipe", permissions: ["manageAdvanced"] },
  { prefix: "/api/plugins", permissions: ["managePlugins"] },
  { prefix: "/api/media-providers", permissions: ["manageMediaProviders"] },
  { prefix: "/api/usage", permissions: ["viewUsage"] },
  // Read-only catalog for a key session that holds only viewUsage. It answers
  // GET only; any other method falls through to the /api/usage rule above and
  // stays read-only there too, so no write access is ever granted here.
  { prefix: "/api/usage/available-models", permissions: ["viewUsage"], methods: READ_METHODS },
];

// Longest prefix first, so /api/model-editor is not swallowed by a /api/models style
// rule and /api/keys/x is not matched by a shorter sibling. Within one prefix the
// most specific method rule wins, which is why the read rules sit above the write ones.
export function requiredPermissionsForApiPath(pathname, method = "GET") {
  let best = null;
  let bestScore = -1;
  for (const rule of API_PERMISSION_RULES) {
    if (pathname !== rule.prefix && !pathname.startsWith(`${rule.prefix}/`)) continue;
    const verb = String(method || "GET").toUpperCase();
    if (rule.methods && !rule.methods.includes(verb)) continue;
    const score = rule.prefix.length * 2 + (rule.methods ? 1 : 0);
    if (score <= bestScore) continue;
    best = rule.permissions;
    bestScore = score;
  }
  return best;
}

// Dashboard pages an API key session may open. A rule with an empty list closes the
// page to restricted sessions on purpose, so every admin-only page is named here
// and anything added later stays admin-only until it is opened up.
const PAGE_PERMISSION_RULES = [
  { prefix: "/dashboard/endpoint", permissions: ["manageApiKeys"] },
  { prefix: "/dashboard/usage", permissions: ["viewUsage"] },
  { prefix: "/dashboard/api-key-usage", permissions: ["viewUsage", "manageApiKeys"] },
  { prefix: "/dashboard/providers", permissions: ["manageProviders"] },
  { prefix: "/dashboard/quota", permissions: ["manageProviders"] },
  { prefix: "/dashboard/combos", permissions: ["manageModels"] },
  { prefix: "/dashboard/model-editor", permissions: ["manageModels"] },
  { prefix: "/dashboard/arena", permissions: ["manageModels"] },
  { prefix: "/dashboard/cli-tools", permissions: ["manageTools"] },
  { prefix: "/dashboard/token-saver", permissions: ["manageTools"] },
  { prefix: "/dashboard/console-log", permissions: ["manageAdvanced"] },
  { prefix: "/dashboard/translator", permissions: ["manageAdvanced"] },
  { prefix: "/dashboard/proxy-pools", permissions: ["manageAdvanced"] },
  { prefix: "/dashboard/pxpipe", permissions: ["manageAdvanced"] },
  { prefix: "/dashboard/mitm", permissions: ["manageAdvanced"] },
  { prefix: "/dashboard/plugins", permissions: ["managePlugins"] },
  { prefix: "/dashboard/skills", permissions: ["managePlugins"] },
  { prefix: "/dashboard/media-providers", permissions: ["manageMediaProviders"] },
  { prefix: "/dashboard/basic-chat", permissions: [] },
  { prefix: "/dashboard/profile", permissions: [] },
  // The dashboard index renders the endpoint page, so it follows the same permission.
  // Exact, so a page added later stays admin-only until it is named above.
  { prefix: "/dashboard", permissions: ["manageApiKeys"], exact: true },
];

// null means no rule matched, which canOpenPage reads as admin only. [] is also
// closed to restricted sessions: canOpenPage asks whether ANY listed permission is
// held, and an empty list has none to ask about. Write the permission name a page
// needs; leaving [] is only a way to keep a page shut.
export function requiredPermissionsForPage(pathname) {
  let best = null;
  let bestLength = -1;
  for (const rule of PAGE_PERMISSION_RULES) {
    const matches = rule.exact
      ? pathname === rule.prefix
      : pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`);
    if (!matches) continue;
    if (rule.prefix.length <= bestLength) continue;
    best = rule.permissions;
    bestLength = rule.prefix.length;
  }
  return best;
}

export function canOpenPage(pathname, permissions) {
  const needed = requiredPermissionsForPage(pathname);
  if (needed === null) return false;
  const have = normalizePermissions(permissions);
  return needed.some((key) => have[key]);
}

// Landing page for a session, used after login and to bounce a restricted session
// away from a page it has no permission for. Null when the key holds nothing usable.
// Ordered so a broader permission is tried first: a full admin still lands on the
// endpoint page even though every later candidate would also open.
export function firstAllowedPage(permissions) {
  const candidates = [
    { path: "/dashboard/endpoint", permissions: ["manageApiKeys"] },
    { path: "/dashboard/usage", permissions: ["viewUsage"] },
    { path: "/dashboard/providers", permissions: ["manageProviders"] },
    { path: "/dashboard/model-editor", permissions: ["manageModels"] },
    { path: "/dashboard/combos", permissions: ["manageModels"] },
    { path: "/dashboard/quota", permissions: ["manageProviders"] },
    { path: "/dashboard/media-providers", permissions: ["manageMediaProviders"] },
    { path: "/dashboard/plugins", permissions: ["managePlugins"] },
    { path: "/dashboard/cli-tools", permissions: ["manageTools"] },
    { path: "/dashboard/token-saver", permissions: ["manageTools"] },
    { path: "/dashboard/console-log", permissions: ["manageAdvanced"] },
    { path: "/dashboard/translator", permissions: ["manageAdvanced"] },
    { path: "/dashboard/proxy-pools", permissions: ["manageAdvanced"] },
  ];
  const have = normalizePermissions(permissions);
  for (const candidate of candidates) {
    if (candidate.permissions.some((key) => have[key])) return candidate.path;
  }
  return null;
}
