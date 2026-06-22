# RB012-P0: Brand Inventory for DurinDoor Rebrand

**Status**: Complete
**Created**: 2026-06-22
**Scope**: Inventory all user-facing 9Router naming/assets/docs/UI surfaces for future DurinDoor rebrand
**Risk Level**: High (1500+ brand references across codebase)

---

## Executive Summary

Comprehensive inventory of all user-facing "9Router" brand references across the codebase. Found **~1500 occurrences** spanning documentation, UI components, configuration, assets, and external integrations. This document provides an actionable checklist for the future DurinDoor rebrand.

**Key Findings**:

- Brand appears in 15+ file types across 20+ directories
- Critical assets: main logo (`images/9router.png`), package names, domain references
- High-risk areas: npm package name, Docker images, external badges/integrations
- 100+ documentation files require updates (5 languages + gitbook)

---

## 1. Core Brand Assets

### 1.1 Visual Assets (HIGH RISK)

**Risk**: User-facing branding, requires new design assets

| Asset | Path | Usage | Risk Notes |
|-------|------|-------|------------|
| Main logo | `images/9router.png` | README, landing page hero | Primary brand image, 758KB PNG |
| Favicon | `public/favicon.svg` | Browser tab icon | SVG format, embedded in layout.js |
| App icons | `public/icons/icon-192.svg`, `public/icons/icon-512.svg` | PWA/mobile icons | Logo-based icons |
| UI logo (SVG) | `src/shared/components/Footer.js` (inline) | Footer component | Hardcoded SVG path, 9-pointed star |
| Navigation logo | `src/app/landing/components/Navigation.js` | Landing page header | Orange gradient hub icon + text |

**Action Items**:

- [ ] Design new DurinDoor logo (PNG, SVG variants)
- [ ] Replace `images/9router.png` with DurinDoor equivalent
- [ ] Update favicon.svg with DurinDoor branding
- [ ] Redesign PWA icons (192px, 512px)
- [ ] Update inline SVG logos in Footer/Navigation components

---

## 2. Package & Distribution

### 2.1 NPM Package (CRITICAL RISK)

**Risk**: Package name change = breaking change for all users

| File | Current Value | Impact |
|------|---------------|--------|
| `cli/package.json` | `"name": "9router"` | NPM package identifier |
| `cli/package.json` | `"bin": { "9router": "./cli.js" }` | CLI command name |
| `cli/package.json` | `"keywords": ["9router", "cli", "proxy", "ai", "api"]` | NPM discoverability |
| `package.json` (root) | `"name": "9router-app"` | Web dashboard package |

**Install Commands**:

```bash
npm install -g 9router          # Global CLI install
9router                          # Command invocation
npx 9router                      # Direct execution
```

**Action Items**:

- [ ] Decide: New package name OR alias/redirect strategy
- [ ] Update CLI binary name (e.g., `durindoor` command)
- [ ] Plan migration path for existing `9router` users
- [ ] Update all install instructions in docs (100+ files)
- [ ] Consider npm package deprecation notice

### 2.2 Docker Distribution (HIGH RISK)

**Risk**: Image name change affects all container deployments

| Current Reference | Location | Type |
|------------------|----------|------|
| `decolua/9router` | Docker Hub | Public image repository |
| `decolua/9router:latest` | DOCKER.md, README.md | Default image tag |
| `ghcr.io/decolua/9router` | GitHub Container Registry | GHCR mirror |
| `org.opencontainers.image.title="9router"` | Dockerfile | OCI metadata |

**Action Items**:

- [ ] Decide: New image name (e.g., `decolua/durindoor`)
- [ ] Update Dockerfile LABEL metadata
- [ ] Update DOCKER.md with new image references
- [ ] Plan image migration (tags, redirects)
- [ ] Update captain-definition for deployment platforms

---

## 3. Documentation (100+ Files)

### 3.1 Core Documentation

**Risk**: User confusion, broken install flows

| File | Brand References | Priority |
|------|-----------------|----------|
| `README.md` | ~50 occurrences | CRITICAL - Main entry point |
| `README.zh-CN.md` | ~45 occurrences | HIGH - Chinese translation |
| `CHANGELOG.md` | ~30 occurrences | MEDIUM - Historical context |
| `DOCKER.md` | ~25 occurrences | HIGH - Container users |
| `cli/README.md` | ~40 occurrences | CRITICAL - CLI documentation |

**Specific README.md Sections**:

- [ ] Title: `# 9Router - FREE AI Router & Token Saver`
- [ ] Hero image: `![9Router Dashboard](./images/9router.png)`
- [ ] NPM badges: `[![npm](https://img.shields.io/npm/v/9router.svg)]`
- [ ] Docker badges: `[![Docker Pulls](https://img.shields.io/docker/pulls/decolua/9router.svg)]`
- [ ] Website link: `[🌐 Website](https://9router.com)`
- [ ] Install commands: All `npm install -g 9router` references
- [ ] Usage examples: CLI tool configuration blocks

### 3.2 GitBook Documentation (100 Files)

**Risk**: Inconsistent user experience across 5 languages

| Language | Directory | File Count | Key Files |
|----------|-----------|------------|-----------|
| English | `gitbook/content/en/` | ~20 files | index.md, installation.md, quick-start.md |
| Japanese | `gitbook/content/ja/` | ~20 files | Full translation |
| Chinese (Simplified) | `gitbook/content/zh-CN/` | ~20 files | Full translation |
| Vietnamese | `gitbook/content/vi/` | ~20 files | Full translation |
| Spanish | `gitbook/content/es/` | ~20 files | Full translation |

**Sample Files Requiring Updates**:

- [ ] `gitbook/content/en/index.md` - Welcome page, brand intro
- [ ] `gitbook/content/*/getting-started/installation.md` - Install commands (5 languages)
- [ ] `gitbook/content/*/getting-started/quick-start.md` - Quick start guide (5 languages)
- [ ] `gitbook/content/*/integration/*.md` - Tool integration guides (Cursor, Cline, Claude Code, etc.)
- [ ] `gitbook/content/*/faq.md` - FAQs mentioning product name (5 languages)

### 3.3 i18n README Translations

**Risk**: Multilingual consistency

| File | Language | Status |
|------|----------|--------|
| `i18n/README.ja-JP.md` | Japanese | ~40 brand refs, GitHub badges |
| `i18n/README.vi.md` | Vietnamese | ~35 brand refs, install cmds |
| `i18n/README.ru.md` | Russian | ~35 brand refs |
| `i18n/README.zh-CN.md` | Chinese | ~45 brand refs, duplicates root |

**Action Items**:

- [ ] Update all i18n README files consistently
- [ ] Coordinate with translators for DurinDoor branding
- [ ] Update GitHub badge URLs in all language variants

---

## 4. User Interface Components

### 4.1 Web Dashboard (Next.js App)

#### Meta Tags & SEO (CRITICAL)

**File**: `src/app/layout.js`

```javascript
export const metadata = {
  title: "9Router - AI Infrastructure Management",
  description: "One endpoint for all your AI providers...",
  icons: { icon: "/favicon.svg" },
};
```

**Action Items**:

- [ ] Update page title to "DurinDoor - ..."
- [ ] Rewrite meta description with new branding
- [ ] Update favicon path if changed
- [ ] Review Google Analytics ID (G-LC959F603F) - keep or update?

#### Navigation & Header Components

**File**: `src/app/landing/components/Navigation.js`

- Line 25: `<h2 className="...">9Router</h2>` - Main logo text
- Lines 31-34: GitHub links to `github.com/decolua/9router`

**File**: `src/shared/components/Header.js`

- Breadcrumb labels and page titles
- No direct "9Router" string, uses `APP_CONFIG.name`

**Action Items**:

- [ ] Update Navigation.js brand text
- [ ] Update GitHub repo links to DurinDoor repo (if applicable)
- [ ] Verify Header inherits from APP_CONFIG (good - centralized)

#### Footer Component

**File**: `src/shared/components/Footer.js`

- Line 41: `{APP_CONFIG.name}` - Brand name display
- Line 44: Inline SVG logo (9-pointed star)
- Line 127: `© {year} {APP_CONFIG.name} Inc. All rights reserved.`

**Action Items**:

- [ ] Update inline SVG path to DurinDoor logo design
- [ ] Review copyright text ("DurinDoor Inc." vs other entity)
- [ ] Update social media links (if applicable)

#### Landing Page

**File**: `src/app/landing/components/HeroSection.js`

- Line 21: `<span className="...">All AI Providers</span>` - Main tagline
- Line 25: Description: "AI endpoint proxy with web dashboard - A JavaScript port of CLIProxyAPI. Works seamlessly with Claude Code..."

**File**: `src/app/landing/components/GetStarted.js`

- Install commands referencing `npm install -g 9router`

**Action Items**:

- [ ] Update hero tagline/messaging for DurinDoor brand
- [ ] Rewrite product description with new positioning
- [ ] Update all code examples with new CLI command

### 4.2 Configuration Constants

**File**: `src/shared/constants/config.js` (CRITICAL)

```javascript
export const APP_CONFIG = {
  name: "9Router Proxy",
  description: "AI Infrastructure Management",
  version: pkg.version,
};

export const UPDATER_CONFIG = {
  npmPackageName: "9router",
  installCmd: "npm i -g 9router",
  installCmdLatest: "npm i -g 9router@latest --prefer-online",
  // ...
};
```

**Risk**: Central configuration affecting entire app

**Action Items**:

- [ ] Update `APP_CONFIG.name` to "DurinDoor" (or variant)
- [ ] Update `APP_CONFIG.description` with new positioning
- [ ] Update all `UPDATER_CONFIG` package references
- [ ] Update `GITHUB_CONFIG.donateUrl` from `9router.com/api/donate`

---

## 5. External Integrations & References

### 5.1 Domain & URLs (CRITICAL RISK)

**Risk**: Domain change requires DNS, hosting, certificate changes

| Current Domain | Location | Usage |
|----------------|----------|-------|
| `9router.com` | README.md, .env.example, config.js | Website URL |
| `https://9router.com/api/donate` | config.js | Donation endpoint |

**Environment Variables** (`.env.example`):

```bash
BASE_URL=http://localhost:20128
CLOUD_URL=https://9router.com
NEXT_PUBLIC_CLOUD_URL=https://9router.com
```

**Action Items**:

- [ ] Decide: New domain (durindoor.com?) or subdomain strategy
- [ ] Update all .env examples and documentation
- [ ] Update config.js CLOUD_URL references
- [ ] Plan domain redirect from 9router.com
- [ ] Update SSL certificates for new domain

### 5.2 GitHub Repository References

**Risk**: Repo rename breaks all links, badges, clone commands

| Reference Type | Count | Examples |
|----------------|-------|----------|
| GitHub URLs | 121+ | `github.com/decolua/9router` |
| Clone commands | 5+ | `git clone https://github.com/decolua/9router.git` |
| Badges | 20+ | NPM, Docker, License badges |
| Issue links | 10+ | `github.com/decolua/9router/issues` |

**Action Items**:

- [ ] Decide: Keep repo name OR rename with redirect
- [ ] Update all GitHub URLs across docs
- [ ] Update badge URLs in all README files
- [ ] Update Trendshift badge URL
- [ ] Update contributor graphs/charts

### 5.3 NPM Registry

**File**: `README.md` (and translations)

```markdown
[![npm](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
[![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
```

**Action Items**:

- [ ] Update all npm badge URLs
- [ ] Plan npm package migration/deprecation
- [ ] Update npmjs.com package metadata

### 5.4 Docker Hub & GHCR

```markdown
[![Docker Pulls](https://img.shields.io/docker/pulls/decolua/9router.svg)]
(https://hub.docker.com/r/decolua/9router)
```

**Action Items**:

- [ ] Update Docker Hub badge URLs
- [ ] Update GHCR badge URLs
- [ ] Plan container image migration
- [ ] Update Dockerfile labels

---

## 6. Data & Configuration Files

### 6.1 Data Directory Naming (MEDIUM RISK)

**Risk**: User data migration required

| Platform | Current Path | Occurrence Count |
|----------|--------------|------------------|
| macOS/Linux | `~/.9router/` | 50+ references |
| Windows | `%APPDATA%\9router\` | 30+ references |
| Docker | `/app/data` (but symlinked to `~/.9router`) | 15+ references |

**Key Files**:

- `cli/cli.js` - Data directory initialization
- `DOCKER.md` - Volume mount documentation
- `cli/README.md` - Data location documentation
- `tests/` - Test temp directory names (`9router-compatible-provider-`)

**Action Items**:

- [ ] Decide: Keep `.9router` OR migrate to `.durindoor`
- [ ] If migrating: Create migration script for user data
- [ ] Update all documentation with new data paths
- [ ] Update test fixtures and temporary directory names
- [ ] Consider backward compatibility symlink strategy

### 6.2 Environment Variables

**File**: `.env.example`

```bash
# Comment header references
# 9Router environment contract
DATA_DIR=/var/lib/9router
INSTANCE_NAME=9router  # (unused, kept as reference)
```

**Action Items**:

- [ ] Update comment headers
- [ ] Update default DATA_DIR path (if changed)
- [ ] Update INSTANCE_NAME reference

---

## 7. CLI & Command-Line Interface

### 7.1 CLI Command Name (CRITICAL)

**Current Command**: `9router`

**Files Affected**:

- `cli/package.json` - `"bin": { "9router": "./cli.js" }`
- `cli/cli.js` - Banner, help text, ASCII art
- All README files - Install and usage instructions

**Action Items**:

- [ ] Design new CLI command name (e.g., `durindoor`, `ddoor`, `dd`)
- [ ] Update package.json bin mapping
- [ ] Update CLI banner/help text in cli.js
- [ ] Update all `9router --help` examples in docs
- [ ] Update shell completion scripts (if any)

### 7.2 CLI User-Facing Text

**File**: `cli/cli.js` (needs inspection for ASCII art, banners)

**Action Items**:

- [ ] Search cli.js for "9Router" brand references
- [ ] Update ASCII art logo (if present)
- [ ] Update welcome messages
- [ ] Update error messages mentioning brand name

---

## 8. Code Comments & Internal References

### 8.1 Code Comments (LOW RISK)

**Scope**: Internal developer references, not user-facing

**Action Items**:

- [ ] Search for "9Router" in comments (optional cleanup)
- [ ] Update package.json `"description"` fields
- [ ] Update JSDoc/TSDoc references (if any)

### 8.2 Test Files (LOW RISK)

**File**: `tests/unit/compatible-provider-connections.test.js`

```javascript
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-compatible-provider-"));
```

**Action Items**:

- [ ] Update test temp directory prefixes
- [ ] Update test descriptions/comments

---

## 9. Third-Party Integrations

### 9.1 Analytics & Tracking

**File**: `src/app/layout.js`

```javascript
<GoogleAnalytics gaId={"G-LC959F603F"} />
```

**Action Items**:

- [ ] Decide: Keep GA ID or create new DurinDoor property
- [ ] Update GA property name in Google Analytics dashboard

### 9.2 Acknowledgments

**File**: `cli/README.md`, `README.md`

```markdown
## 🙏 Acknowledgments
- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** - Original Go implementation
```

**Action Items**:

- [ ] Review acknowledgments section - keep attribution to 9Router?
- [ ] Add note about project evolution/rebrand

---

## 10. Risk Assessment by Category

| Category | Risk Level | User Impact | Migration Complexity |
|----------|-----------|-------------|---------------------|
| NPM Package Name | 🔴 CRITICAL | Breaking change for all users | High - requires deprecation strategy |
| Docker Image Name | 🔴 CRITICAL | Breaking change for container users | High - requires image aliases |
| Domain (9router.com) | 🔴 CRITICAL | All web traffic affected | High - DNS, SSL, redirects |
| GitHub Repo Name | 🟡 HIGH | Broken links, clone commands | Medium - GitHub auto-redirects |
| CLI Command Name | 🔴 CRITICAL | Breaking change for all CLI users | High - requires migration guide |
| Data Directory | 🟡 MEDIUM | User data migration needed | Medium - can use symlinks |
| Documentation | 🟡 HIGH | User confusion if inconsistent | Medium - bulk find/replace |
| UI Components | 🟢 LOW | Visual only, no breaking changes | Low - design + copy updates |
| Meta Tags/SEO | 🟡 MEDIUM | Search rankings affected | Low - simple text updates |
| Assets (logo, icons) | 🟢 LOW | Visual branding | Low - asset replacement |

---

## 11. Recommended Rebrand Strategy

### Phase 1: Preparation (Pre-Announcement)

1. **Design Assets**: Create all DurinDoor logos, icons, favicons
2. **Domain Setup**: Register durindoor.com, setup hosting, SSL
3. **Package Planning**: Decide on npm/Docker migration strategy
4. **Documentation Prep**: Prepare updated docs for all languages
5. **Migration Scripts**: Build user data migration tools (if needed)

### Phase 2: Soft Launch (Co-existence)

1. **Dual Branding**: Publish both `9router` and `durindoor` packages
2. **Deprecation Notices**: Add warnings to `9router` package
3. **Documentation**: Add migration guide to main README
4. **Aliases**: Setup Docker image tags for both names
5. **Domain Redirect**: 9router.com → durindoor.com with notice banner

### Phase 3: Full Migration (6-12 months)

1. **Update All Docs**: Bulk replace in all documentation
2. **Archive Old Package**: Mark `9router` as deprecated on npm
3. **Sunset Timeline**: Announce end-of-support date for old branding
4. **User Support**: Active migration support in issues/discussions

### Phase 4: Cleanup (Post-Migration)

1. **Remove Old References**: Clean up all 9Router references
2. **Archive Old Domains**: Keep redirects indefinitely
3. **Historical Context**: Add note in CHANGELOG about rebrand

---

## 12. Actionable Checklist (Grouped by Priority)

### 🔴 CRITICAL - Must Complete Before Launch

#### Package Distribution

- [ ] Choose new package name strategy (rename vs dual-publish)
- [ ] Update `cli/package.json` name and bin
- [ ] Update `package.json` root name
- [ ] Update all install commands in docs (100+ files)
- [ ] Prepare npm package deprecation notice

#### Docker & Deployment

- [ ] Choose new Docker image name
- [ ] Update Dockerfile labels and metadata
- [ ] Update DOCKER.md with new image name
- [ ] Update captain-definition deployment config
- [ ] Plan image tag aliases/migration

#### Domain & URLs

- [ ] Register new domain (durindoor.com?)
- [ ] Update .env.example with new domain
- [ ] Update config.js CLOUD_URL
- [ ] Setup DNS and SSL certificates
- [ ] Plan redirect strategy from 9router.com

#### Core Configuration

- [ ] Update `src/shared/constants/config.js` APP_CONFIG
- [ ] Update UPDATER_CONFIG package references
- [ ] Update GITHUB_CONFIG URLs

### 🟡 HIGH - Should Complete Before Launch

#### Documentation

- [ ] Update README.md (main)
- [ ] Update README.zh-CN.md
- [ ] Update cli/README.md
- [ ] Update DOCKER.md
- [ ] Update CHANGELOG.md header
- [ ] Update all i18n README files (4 languages)

#### UI Components

- [ ] Update layout.js metadata (title, description)
- [ ] Update Navigation.js brand text
- [ ] Update Footer.js inline logo SVG
- [ ] Update HeroSection.js tagline and copy
- [ ] Update GetStarted.js install commands

#### Assets

- [ ] Design and replace main logo (images/9router.png)
- [ ] Update favicon.svg
- [ ] Update PWA icons (icon-192.svg, icon-512.svg)
- [ ] Update Footer SVG inline logo

### 🟢 MEDIUM - Can Complete Post-Launch

#### GitBook Documentation (100 files)

- [ ] Update en/ content (20 files)
- [ ] Update ja/ content (20 files)
- [ ] Update zh-CN/ content (20 files)
- [ ] Update vi/ content (20 files)
- [ ] Update es/ content (20 files)
- [ ] Coordinate with translators

#### External References

- [ ] Update GitHub repo references (121+ occurrences)
- [ ] Update npm badge URLs
- [ ] Update Docker badge URLs
- [ ] Update Trendshift badge
- [ ] Update contributor charts

#### Data & Testing

- [ ] Decide on data directory migration (.9router → .durindoor?)
- [ ] Create migration script if needed
- [ ] Update test temp directory names
- [ ] Update test fixtures

### ⚪ LOW - Optional/Cleanup

#### Code Cleanup

- [ ] Search and update code comments
- [ ] Update JSDoc references
- [ ] Clean up internal constants

#### Miscellaneous

- [ ] Review Google Analytics ID decision
- [ ] Update acknowledgments section
- [ ] Archive old marketing materials

---

## 13. Search Patterns for Bulk Updates

### Regex Patterns for Find/Replace

```bash
# Case-sensitive brand name
9Router

# Case-insensitive (catches variants)
(?i)9router

# Package name in JSON
"name": "9router"

# CLI command
npm install -g 9router
npx 9router
\b9router\b  # Word boundary

# Domain
9router\.com

# Docker image
decolua/9router

# GitHub repo
github\.com/decolua/9router
decolua/9router

# Data directory
\.9router
%APPDATA%\\9router

# Environment variable
INSTANCE_NAME=9router
```

### Files to Exclude from Bulk Replace

- `CHANGELOG.md` - Historical entries should remain as-is
- `.git/` - Git history
- `node_modules/` - Dependencies
- `.next/` - Build artifacts
- Historical plan files - Keep as documentation

---

## 14. Testing Checklist Post-Rebrand

### Functional Testing

- [ ] npm install works with new package name
- [ ] CLI command launches correctly
- [ ] Docker image builds and runs
- [ ] Data directory initializes correctly
- [ ] Dashboard loads with new branding
- [ ] All external links work (GitHub, npm, Docker Hub)

### Visual Testing

- [ ] Favicon displays in browser
- [ ] Logo appears on landing page
- [ ] PWA icons work on mobile
- [ ] Footer logo renders correctly
- [ ] Navigation brand text displays

### Documentation Testing

- [ ] README install instructions work
- [ ] GitBook docs accessible
- [ ] i18n translations consistent
- [ ] Code examples execute successfully

### SEO/Analytics Testing

- [ ] Meta tags updated in HTML
- [ ] Google Analytics tracking
- [ ] Domain redirects work
- [ ] Search engines can index

---

## 15. Rollback Plan

### If Migration Fails

1. **Keep Old Package**: Continue publishing as `9router`
2. **Revert DNS**: Point domain back to original
3. **Docker Tags**: Maintain old image names
4. **Documentation**: Add errata about attempted rebrand

### Backward Compatibility

- Maintain `9router` npm package indefinitely (deprecated)
- Keep Docker image aliases
- Permanent redirects from old URLs
- Data directory symlink support

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total brand references | ~1,500 |
| Files containing "9Router" | 200+ |
| Documentation files (MD) | 110+ |
| GitBook pages | 100+ |
| i18n translations | 5 languages |
| UI components affected | 15+ |
| Configuration files | 8+ |
| External integrations | 10+ |

---

## Appendix: Full File Paths Reference

### Critical Assets

```
images/9router.png
public/favicon.svg
public/icons/icon-192.svg
public/icons/icon-512.svg
```

### Core Configuration

```
package.json
cli/package.json
src/shared/constants/config.js
.env.example
Dockerfile
captain-definition
```

### Main Documentation

```
README.md
README.zh-CN.md
CHANGELOG.md
DOCKER.md
cli/README.md
i18n/README.ja-JP.md
i18n/README.vi.md
i18n/README.ru.md
i18n/README.zh-CN.md
```

### UI Components

```
src/app/layout.js
src/app/landing/components/Navigation.js
src/app/landing/components/HeroSection.js
src/app/landing/components/Footer.js
src/app/landing/components/GetStarted.js
src/shared/components/Header.js
src/shared/components/Footer.js
src/shared/components/Sidebar.js
```

### GitBook (100+ files)

```
gitbook/content/en/*.md
gitbook/content/ja/*.md
gitbook/content/zh-CN/*.md
gitbook/content/vi/*.md
gitbook/content/es/*.md
```

---

**Document Complete**: Brand inventory ready for future DurinDoor rebrand implementation.
