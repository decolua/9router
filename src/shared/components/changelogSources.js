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
    color: "#191817",
    border: "#191817",
    bg: "#c8ee68",
    icon: "workspace_premium",
  },
};

export const DECOLUA_SOURCE = {
  id: "decolua",
  label: "Decolua",
  heading: "Official Releases (Decolua)",
  accent: {
    color: "#191817",
    border: "#191817",
    bg: "#83d8e8",
    icon: "article",
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
