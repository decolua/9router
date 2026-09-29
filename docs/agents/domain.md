# Domain Docs

**Layout:** Single-context
**Root:** `CONTEXT.md`
**ADRs:** `docs/adr/` (currently empty, create as needed)

## Consumer Rules
1.  **Read `CONTEXT.md` first:** Before exploring code or writing specs, read the root `CONTEXT.md` to understand the Ubiquitous Language (Router, Operator, Provider, Connection, etc.).
2.  **Use the vocabulary:** When writing specs, tickets, or code comments, use the terms defined in `CONTEXT.md`. Avoid synonyms like "User" (use Operator/Client) or "Service" (use Provider).
3.  **Update inline:** If a new term is discovered or a definition is sharpened during a grilling session, update `CONTEXT.md` immediately.
4.  **ADRs:** Architectural decisions that are hard to reverse go in `docs/adr/NNNN-title.md`. Link to them from `CONTEXT.md` if they define a term.