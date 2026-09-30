/**
 * Which changelog the modal is showing.
 *
 * Serenhope's fork and Decolua's upstream are separate documents from separate
 * repos, so they get a switcher instead of one concatenated scroll. The tricky
 * part is not the switching, it is the states where one of them is missing:
 * a tab that leads nowhere, or the body pointing at a source that loaded
 * nothing, both render as a blank panel with no explanation.
 *
 * No imports, so changelogSourcesSelfCheck.mjs can run it under plain node.
 */

export const SERENHOPE_SOURCE = {
  id: "serenhope",
  label: "Serenhope",
  heading: "Contributed by Serenhope",
  accent: {
    color: "#60a5fa",
    border: "rgba(96,165,250,0.35)",
    bg: "rgba(96,165,250,0.06)",
    icon: "star",
  },
};

export const DECOLUA_SOURCE = {
  id: "decolua",
  label: "Decolua",
  heading: "Official Releases (Decolua)",
  accent: {
    color: "rgba(148,163,184,0.95)",
    border: "rgba(148,163,184,0.25)",
    bg: "rgba(148,163,184,0.05)",
    icon: "history_edu",
  },
};

// Serenhope first: this is the fork, and its own releases are what the user
// opened the modal for.
export const CHANGELOG_SOURCES = [SERENHOPE_SOURCE, DECOLUA_SOURCE];

export const DEFAULT_CHANGELOG_SOURCE = SERENHOPE_SOURCE.id;

/** Sources that actually have rendered content, in display order. */
export function availableChangelogSources(htmlBySource) {
  if (!htmlBySource || typeof htmlBySource !== "object") return [];
  return CHANGELOG_SOURCES.filter((source) => {
    const html = htmlBySource[source.id];
    return typeof html === "string" && html.trim().length > 0;
  });
}

/**
 * The source to render. Falls back to the first one that has content, so a
 * stale or emptied selection never leaves the body blank.
 */
export function pickChangelogSource(htmlBySource, activeSource) {
  if (availableChangelogSources(htmlBySource).some((s) => s.id === activeSource)) {
    return activeSource;
  }
  return availableChangelogSources(htmlBySource)[0]?.id || DEFAULT_CHANGELOG_SOURCE;
}
