const HOMEBREW_PACKAGE_MANAGER = "homebrew";

function isHomebrewManaged(env = process.env) {
  return env.NINEROUTER_PACKAGE_MANAGER === HOMEBREW_PACKAGE_MANAGER;
}

function getUpdateCommand(packageName, env = process.env) {
  if (isHomebrewManaged(env)) {
    return `brew update && brew upgrade ${packageName}`;
  }
  return `npm i -g ${packageName}@latest --prefer-online`;
}

module.exports = { getUpdateCommand, isHomebrewManaged };
