"use strict";
function validate(file, validatorPath) {
  try {
    const { loadPolicy } = require(validatorPath);
    const policy = loadPolicy(file);
    if (!policy?.enabled) throw Error();
    return { success: true, modelCount: Object.keys(policy.mappings).length };
  } catch { return { success: false, error: "INVALID_ROUTING_PROFILE" }; }
}
if (require.main === module) {
  const result = validate(process.argv[2], process.argv[3]);
  process.stdout.write(JSON.stringify(result) + "\n");
  if (!result.success) process.exitCode = 1;
}
module.exports = { validate };
