function findMappedOverride({ tool, model, aliases, synonyms = {}, patterns = {} }) {
  if (!model || !aliases) return null;

  const normalizedModel = String(model).replace(/^models\//, "");
  const lookup = synonyms?.[tool]?.[normalizedModel] || normalizedModel;
  if (aliases[lookup]) return aliases[lookup];

  const prefixKey = Object.keys(aliases).find(
    (key) => key && aliases[key] && (lookup.startsWith(key) || key.startsWith(lookup))
  );
  if (prefixKey) return aliases[prefixKey];

  for (const { match, alias } of patterns?.[tool] || []) {
    if (match.test(lookup) && aliases[alias]) return aliases[alias];
  }

  return null;
}

module.exports = { findMappedOverride };
