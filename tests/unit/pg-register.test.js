import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPostgresAdapter } from "@/lib/db/adapters/postgresAdapter.js";

const url = process.env.DATABASE_URL || "postgres://ebrouter:ebrouter@localhost:5432/ebrouter_render_test";

describe("postgres register-org", () => {
  let adapter;

  beforeAll(async () => {
    adapter = await createPostgresAdapter(url);
    global._dbAdapter = { instance: adapter, initPromise: null, logged: true };
    const { runMigrationOncePostgres } = await import("@/lib/db/migratePostgres.js");
    await runMigrationOncePostgres(adapter);
  }, 60000);

  afterAll(async () => {
    try {
      await adapter?.close?.();
    } catch {}
    delete global._dbAdapter;
  });

  it("creates org admin user with orgId", async () => {
    const { createOrganization } = await import("@/lib/db/repos/organizationsRepo.js");
    const { createOrgSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const { createUser } = await import("@/lib/db/repos/usersRepo.js");

    const slug = `co-${Date.now()}`;
    const org = await createOrganization({ slug, name: "PG Test Co" });
    expect(org.id).toBeTruthy();

    await createOrgSettings(org.id, { multiUserEnabled: true, signupMode: "invite" });

    const user = await createUser({
      orgId: org.id,
      email: `${slug}@example.com`,
      name: "Admin",
      password: "Password123!",
      role: "admin",
      requireOrgId: true,
    });

    expect(user.orgId).toBe(org.id);

    const cols = await adapter.all(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' AND column_name ILIKE 'orgid'`,
    );
    expect(cols).toHaveLength(1);
    expect(cols[0].column_name).toBe("orgId");
  }, 30000);
});
