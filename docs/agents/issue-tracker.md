# Issue Tracker

**Type:** Local Markdown
**Location:** `.scratch/<feature>/issues/`

Issues are tracked as markdown files within the repository under `.scratch/`. Each feature gets its own directory, and tickets are numbered files within an `issues/` subdirectory.

## Workflow
1.  **Spec:** Create a spec file (e.g., `01-spec-name.md`) in the feature directory.
2.  **Tickets:** Break the spec into vertical slice tickets (e.g., `02-ticket-name.md`).
3.  **Status:** Use the `Status:` field in the ticket header (`ready-for-agent`, etc.).
4.  **Completion:** Check off acceptance criteria in the ticket file.

## Tools
-   No external CLI (gh/glab) is used for issue creation; files are written directly.
-   `to-spec`, `to-tickets`, and `triage` skills read/write these files.