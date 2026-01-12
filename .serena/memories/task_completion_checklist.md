# Task Completion Checklist

When completing a development task, follow this checklist to ensure quality and consistency.

## Code Quality

### 1. Linting
```bash
npx eslint .              # Run linter on all files
npx eslint . --fix        # Auto-fix issues where possible
```

**Check for**:
- No ESLint errors
- No console.log statements in production code (use proper logging)
- No unused imports or variables
- Consistent code style

### 2. Code Review
- [ ] Code follows project conventions (see code_style_conventions.md)
- [ ] Proper error handling implemented
- [ ] No hardcoded credentials or sensitive data
- [ ] Path aliases used (`@/` instead of relative paths)
- [ ] Comments added for complex logic

## Functionality

### 3. Manual Testing
Test the changes manually:

**For API changes**:
```bash
# Test OpenAI format endpoint
curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"test"}]}'

# Test Claude format endpoint
curl http://localhost:20128/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-3.5","messages":[{"role":"user","content":"test"}]}'
```

**For dashboard changes**:
- [ ] Test in development mode (`npm run dev`)
- [ ] Check browser console for errors
- [ ] Test responsive design (mobile/desktop)
- [ ] Verify state management works correctly

**For translator changes**:
- [ ] Test request translation (source → OpenAI → target)
- [ ] Test response translation (target → OpenAI → source)
- [ ] Test streaming responses
- [ ] Verify error handling

### 4. Build Verification
```bash
npm run build             # Ensure build succeeds
npm start                 # Test production build locally
```

**Check**:
- [ ] No build errors
- [ ] No warnings (investigate any that appear)
- [ ] Production build works correctly
- [ ] Standalone output generated (`.next/standalone/`)

## Documentation

### 5. Update Documentation
- [ ] Update CLAUDE.md if architecture changed
- [ ] Update README.md if user-facing features changed
- [ ] Add/update code comments for complex logic
- [ ] Update relevant memory files if significant changes made

### 6. Commit Message
Write a clear commit message:
```bash
git add .
git commit -m "feat: Add support for new provider"
# or
git commit -m "fix: Resolve streaming issue in translator"
# or
git commit -m "refactor: Improve executor pattern"
```

**Format**: `<type>: <description>`
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code restructuring
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `chore`: Maintenance tasks

## Provider-Specific Tasks

### Adding a New Provider
When adding a new AI provider, ensure:

1. **Configuration** (`open-sse/config/`)
   - [ ] Added to `constants.js` (PROVIDERS, OAUTH_ENDPOINTS)
   - [ ] Models added to `providerModels.js`

2. **Format Translation** (if not OpenAI-compatible)
   - [ ] Format constant in `translator/formats.js`
   - [ ] Request translator: `translator/request/{format}-to-openai.js`
   - [ ] Response translator: `translator/response/openai-to-{format}.js`
   - [ ] Translators registered in init function

3. **Executor** (if special logic needed)
   - [ ] Custom executor in `open-sse/executors/`
   - [ ] Registered in executor factory

4. **OAuth** (if OAuth provider)
   - [ ] OAuth handler in `src/lib/oauth/{provider}/`
   - [ ] Token refresh logic implemented

5. **Dashboard UI**
   - [ ] Provider added to `src/shared/constants/providers.js`
   - [ ] UI components updated

6. **Testing**
   - [ ] Manual testing with actual API
   - [ ] Test OAuth flow (if applicable)
   - [ ] Test format translation
   - [ ] Test error handling

## Database Changes

### When Modifying Schema
- [ ] Update `src/lib/localDb.js` schema
- [ ] Add migration logic for existing data (if needed)
- [ ] Test with fresh database
- [ ] Test with existing database
- [ ] Document schema changes

## Final Checks

### Before Committing
- [ ] Remove debug code (console.log, commented code)
- [ ] Remove unused imports and files
- [ ] Verify all files saved
- [ ] Run linter one final time
- [ ] Stage all relevant files

### Before Pushing
- [ ] Commits have clear messages
- [ ] No sensitive data in commits
- [ ] Branch is up to date with master
- [ ] Resolve any merge conflicts

### After Pushing
- [ ] Verify remote repository updated
- [ ] Check CI/CD pipeline (if configured)
- [ ] Update issue/PR status if applicable

## Rollback Plan

If issues are discovered:
```bash
git log                    # Check commit history
git revert <commit-hash>   # Revert specific commit
git reset --hard HEAD~1    # Undo last commit (if not pushed)
```

## Notes

- **No automated tests**: Currently relies on manual testing
- **Deployment**: Standalone builds are self-contained
- **Data persistence**: Database changes affect user data in home directory
- **Breaking changes**: Be cautious with API/database schema changes
