import { afterEach } from "vitest";
import { resetDbAdapterForTests } from "../../src/lib/db/driver.js";

if (process.getMaxListeners() < 50) {
  process.setMaxListeners(50);
}

afterEach(() => {
  resetDbAdapterForTests();
});
