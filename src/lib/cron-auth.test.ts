import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { authorized } from "./cron-auth";

// The gate on every externally-triggerable route. The prod branch below cannot
// be exercised against a running dev server (it depends on MIMIR_ENV at call
// time), which is exactly why it is pinned here.

const SAVED = { ...process.env };
const SECRET = "test-cron-secret-value";

afterEach(() => {
  process.env = { ...SAVED };
});

function req(opts: { auth?: string; key?: string } = {}): NextRequest {
  const url = new URL("http://localhost:3001/api/cron");
  if (opts.key !== undefined) url.searchParams.set("key", opts.key);
  return new NextRequest(url, {
    headers: opts.auth ? { authorization: opts.auth } : {},
  });
}

describe("authorized", () => {
  it("fails closed when CRON_SECRET is not configured", () => {
    delete process.env.CRON_SECRET;
    expect(authorized(req({ auth: "Bearer anything" }))).toBe(false);
    expect(authorized(req({ key: "anything" }))).toBe(false);
  });

  it("accepts a correct Bearer token in either environment", () => {
    process.env.CRON_SECRET = SECRET;
    for (const env of ["dev", "prod"]) {
      process.env.MIMIR_ENV = env;
      expect(authorized(req({ auth: `Bearer ${SECRET}` }))).toBe(true);
    }
  });

  it("rejects a wrong Bearer token, including a correct prefix", () => {
    process.env.CRON_SECRET = SECRET;
    process.env.MIMIR_ENV = "dev";
    expect(authorized(req({ auth: "Bearer wrong" }))).toBe(false);
    expect(authorized(req({ auth: `Bearer ${SECRET.slice(0, -1)}` }))).toBe(false);
    expect(authorized(req({ auth: `Bearer ${SECRET}x` }))).toBe(false);
    expect(authorized(req({ auth: SECRET }))).toBe(false); // missing scheme
  });

  it("accepts ?key= in dev — schedulers that cannot set headers", () => {
    process.env.CRON_SECRET = SECRET;
    process.env.MIMIR_ENV = "dev";
    expect(authorized(req({ key: SECRET }))).toBe(true);
    expect(authorized(req({ key: "wrong" }))).toBe(false);
  });

  it("REFUSES ?key= in prod — the secret would land in access logs", () => {
    process.env.CRON_SECRET = SECRET;
    process.env.MIMIR_ENV = "prod";
    expect(authorized(req({ key: SECRET }))).toBe(false);
    // ...and the header form still works, so nothing is locked out.
    expect(authorized(req({ auth: `Bearer ${SECRET}` }))).toBe(true);
  });

  it("rejects a request carrying neither form", () => {
    process.env.CRON_SECRET = SECRET;
    process.env.MIMIR_ENV = "dev";
    expect(authorized(req())).toBe(false);
  });
});
