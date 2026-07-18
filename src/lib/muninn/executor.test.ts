import { describe, expect, it } from "vitest";
import { computeNextRcaVersion, isRcaDraftAction } from "./executor";

describe("computeNextRcaVersion", () => {
  it("starts at version 1 with nothing to supersede when no prior ACTIVE row exists", () => {
    expect(computeNextRcaVersion(null)).toEqual({ nextVersion: 1, supersedeId: null });
  });

  it("increments the version and supersedes the prior ACTIVE row", () => {
    expect(computeNextRcaVersion({ id: "abc123", version: 1 })).toEqual({
      nextVersion: 2,
      supersedeId: "abc123",
    });
  });

  it("keeps incrementing across repeated regenerations", () => {
    expect(computeNextRcaVersion({ id: "xyz789", version: 4 })).toEqual({
      nextVersion: 5,
      supersedeId: "xyz789",
    });
  });
});

describe("isRcaDraftAction", () => {
  it("recognizes doc.rca_draft actions", () => {
    expect(isRcaDraftAction({ type: "doc.rca_draft" })).toBe(true);
  });

  it("rejects every other action type", () => {
    expect(isRcaDraftAction({ type: "email.draft_reply" })).toBe(false);
    expect(isRcaDraftAction({ type: "crm.update_field" })).toBe(false);
  });
});
