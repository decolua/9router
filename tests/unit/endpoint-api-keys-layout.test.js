import { expect, test } from "vitest";
import fs from "fs";
import path from "path";

  const endpointPagePath = path.join(
    process.cwd(),
    "../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js"
  );

test("EndpointPageClient keeps API key metadata and actions mobile-safe", () => {
  const content = fs.readFileSync(endpointPagePath, "utf-8");

  expect(content).toContain(
    'className={`group flex flex-col sm:flex-row sm:items-center justify-between py-3 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0 gap-3 sm:gap-4 ${key.isActive === false ? "opacity-60" : ""}`}'
  );
  expect(content).toContain('className="flex-1 min-w-0 w-full sm:w-auto"');
  expect(content).toContain(
    'className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:justify-end"'
  );
});
