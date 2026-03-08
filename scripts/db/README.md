# Database scripts

## Migrate

Runs all `.sql` files in `migrations/` in alphabetical order. Uses **DATABASE_URL** from the environment.

**Config:** Set `DATABASE_URL` in `.env` at project root, or pass it when running:

```bash
# From project root (loads .env automatically)
npm run db:migrate

# Or with explicit URL
DATABASE_URL=postgresql://user:pass@localhost:5432/egs_proxy_ai node scripts/db/migrate.js
```

The script loads `.env` from the project root if present, so you can keep `DATABASE_URL` in `.env` and run `npm run db:migrate` without exporting it.
