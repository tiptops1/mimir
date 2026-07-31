import { afterEach, describe, expect, it } from "vitest";
import {
  EnvIdentityError,
  distinctDbHosts,
  hostOf,
  isProd,
  appEnv,
} from "./env-identity";

// S28 safety contract. These are three-line functions, but they are the ones
// deciding whether a script is allowed to write to a paying customer's data,
// so their edges are worth pinning down.

const SAVED = { ...process.env };

afterEach(() => {
  process.env = { ...SAVED };
});

describe("appEnv", () => {
  it("defaults to dev when unset — prod is never implicit", () => {
    delete process.env.MIMIR_ENV;
    expect(appEnv()).toBe("dev");
    expect(isProd()).toBe(false);
  });

  it("treats an empty value as dev", () => {
    process.env.MIMIR_ENV = "";
    expect(appEnv()).toBe("dev");
  });

  it("accepts prod and production, case- and space-insensitively", () => {
    for (const v of ["prod", "PROD", "  Production  ", "production"]) {
      process.env.MIMIR_ENV = v;
      expect(appEnv()).toBe("prod");
      expect(isProd()).toBe(true);
    }
  });

  it("throws on an unrecognised value rather than guessing", () => {
    // "staging" silently falling back to dev would disarm every guard.
    process.env.MIMIR_ENV = "staging";
    expect(() => appEnv()).toThrow(EnvIdentityError);
  });
});

describe("hostOf", () => {
  it("returns the host and never the credentials", () => {
    const uri = "mongodb+srv://someuser:sup3rs3cret@chronos-dev.abc12.mongodb.net/crm_demo?retryWrites=true";
    const host = hostOf(uri);
    expect(host).toBe("chronos-dev.abc12.mongodb.net");
    expect(host).not.toContain("sup3rs3cret");
    expect(host).not.toContain("someuser");
  });

  it("falls back to a regex for a URI the URL parser rejects", () => {
    expect(hostOf("not a url @weird-host.example/db")).toBe("weird-host.example");
  });

  it("returns null for an absent value", () => {
    expect(hostOf(undefined)).toBeNull();
    expect(hostOf("")).toBeNull();
  });
});

describe("distinctDbHosts", () => {
  it("collapses to one host when the environment is consistent", () => {
    process.env.CONTROL_DATABASE_URL = "mongodb+srv://u:p@one.mongodb.net/control";
    process.env.CLUSTER_BASE_URL = "mongodb+srv://u:p@one.mongodb.net/";
    process.env.DATABASE_URL = "mongodb+srv://u:p@one.mongodb.net/demo";
    expect(distinctDbHosts()).toEqual(["one.mongodb.net"]);
  });

  it("reports every host when the .env is half-edited", () => {
    process.env.CONTROL_DATABASE_URL = "mongodb+srv://u:p@one.mongodb.net/control";
    process.env.CLUSTER_BASE_URL = "mongodb+srv://u:p@one.mongodb.net/";
    process.env.DATABASE_URL = "mongodb+srv://u:p@two.mongodb.net/demo";
    expect(distinctDbHosts().sort()).toEqual(["one.mongodb.net", "two.mongodb.net"]);
  });

  it("ignores unset vars rather than counting them as a distinct host", () => {
    process.env.CONTROL_DATABASE_URL = "mongodb+srv://u:p@one.mongodb.net/control";
    delete process.env.CLUSTER_BASE_URL;
    delete process.env.DATABASE_URL;
    expect(distinctDbHosts()).toEqual(["one.mongodb.net"]);
  });
});
