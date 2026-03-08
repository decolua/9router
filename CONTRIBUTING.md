# Contributing to EGS Proxy AI

Thank you for considering contributing to EGS Proxy AI.

## Development guidelines

**See [docs/GUIDELINE.md](docs/GUIDELINE.md)** for:

- Stack, path aliases, and project layout
- API route and error-handling conventions
- Persistence (localDb, usageDb), auth, and logging
- SSE/chat flow and OpenSpec workflow
- Security-sensitive areas and code style

For architecture and request flow, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md).

## How to contribute

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/your-feature`).
3. Make your changes and follow the conventions in [docs/GUIDELINE.md](docs/GUIDELINE.md).
4. Run the linter: `npm run lint` (if available).
5. Commit with a clear message (`git commit -m 'Add ...'`).
6. Push to your fork (`git push origin feature/your-feature`).
7. Open a Pull Request.

For larger or multi-step changes, consider using the OpenSpec workflow (see `openspec/` and `.claude/commands/opsx/`).
