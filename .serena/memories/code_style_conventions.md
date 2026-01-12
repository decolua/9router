# Code Style & Conventions

## Linting & Formatting

### ESLint Configuration
- **Config**: `eslint.config.mjs` (ESLint v9 flat config)
- **Base**: Next.js core-web-vitals rules
- **Ignored Paths**: `.next/`, `out/`, `build/`, `next-env.d.ts`
- **Command**: `npx eslint .`

### Code Style Enforcement
- Uses Next.js recommended ESLint rules
- Follows React 19 best practices
- Next.js App Router conventions

## JavaScript/TypeScript Conventions

### Language
- **Primary**: JavaScript (ES modules)
- **Module System**: ES6 imports/exports
- **Config Files**: `.mjs` extension for config files

### File Organization
- **Components**: React functional components with hooks
- **Path Aliases**: Use `@/` for imports from `src/` directory
  - Example: `import { db } from '@/lib/localDb'`
- **API Routes**: App Router pattern (`src/app/api/*/route.js`)
- **Pages**: App Router pattern (`src/app/*/page.js`)

### Naming Conventions
- **Files**: camelCase for utility files, PascalCase for components
- **Components**: PascalCase (e.g., `ProviderCard.jsx`)
- **Utilities**: camelCase (e.g., `localDb.js`, `tokenRefresh.js`)
- **Constants**: UPPER_SNAKE_CASE in config files
- **Routes**: kebab-case in URL paths

### Component Structure
- Use React 19 features
- Functional components with hooks
- Client components: `'use client'` directive when needed
- Server components: Default in App Router

### State Management
- **Global State**: Zustand stores in `src/store/`
- **Local State**: React useState/useReducer
- **Server State**: Next.js server components where possible

## Styling

### Tailwind CSS
- **Version**: Tailwind CSS 4
- **Config**: PostCSS config in `postcss.config.mjs`
- **Pattern**: Utility-first CSS classes
- **Responsive**: Mobile-first breakpoints
- **Theme**: Custom theme configuration

### CSS Organization
- Prefer Tailwind utility classes
- Avoid custom CSS when possible
- Component-scoped styles when needed

## API & Backend Conventions

### API Routes (Next.js)
- **Pattern**: `src/app/api/v1/[endpoint]/route.js`
- **Methods**: Export named functions: `GET`, `POST`, `PUT`, `DELETE`
- **Response**: Use Next.js `Response` object
- **Headers**: Set appropriate content-type and CORS headers

### Proxy Engine (open-sse/)
- **Pure Functions**: Translator functions are pure
- **Registry Pattern**: Register translators/executors centrally
- **Error Handling**: Return error objects, don't throw
- **Streaming**: Use Transform streams for SSE

### Error Handling
- Return structured error objects: `{ success: false, error: { message, status } }`
- Log errors with colored console output (see `open-sse/utils/stream.js`)
- Don't expose internal errors to clients

## Database Conventions

### LowDB Usage
- **Schema**: Typed objects in `src/lib/localDb.js`
- **Writes**: Use `.write()` after modifications
- **Reads**: Direct property access
- **Defaults**: Initialize with default data structure

### Data Persistence
- All config in `~/.9router/db.json`
- Never store credentials in code or repo
- Separate usage tracking in `usageDb.js`

## Git Conventions

### Commit Messages
- Follow conventional commits when possible
- Clear, descriptive messages
- Reference issue numbers when applicable

### Branch Strategy
- Main branch: `master`
- Feature branches: descriptive names
- Commit before major refactors

## Design Patterns

### Translation Pattern
- All format conversions go through OpenAI format as intermediate
- Request: Source → OpenAI → Target
- Response: Target → OpenAI → Source

### Executor Pattern
- Provider-specific logic in separate executor classes
- Base class with common functionality
- Factory pattern for executor selection

### Service Layer
- Business logic in `open-sse/services/`
- Reusable across handlers and executors
- Pure functions when possible

## Documentation

### Code Comments
- Document complex logic
- Explain "why" not "what"
- Keep comments up-to-date

### File Headers
- No required headers
- JSDoc for complex functions when helpful

## Testing

### Current State
- No automated test suite currently
- Manual testing via endpoints
- Test commands in CLAUDE.md

### Testing Endpoints
Available test curl commands for manual testing:
- OpenAI format: `/v1/chat/completions`
- Claude format: `/v1/messages`
- Responses API: `/v1/responses`
