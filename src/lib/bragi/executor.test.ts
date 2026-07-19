import { describe, expect, it } from "vitest";
import { computeNextContentVersion, isContentDraftAction } from "./executor";

describe("computeNextContentVersion", () => {
  it("starts at version 1 with nothing to supersede when no prior ACTIVE row exists", () => {
    expect(computeNextContentVersion(null)).toEqual({ nextVersion: 1, supersedeId: null });
  });

  it("increments the version and supersedes the prior ACTIVE row", () => {
    expect(computeNextContentVersion({ id: "abc123", version: 1 })).toEqual({
      nextVersion: 2,
      supersedeId: "abc123",
    });
  });

  it("keeps incrementing across repeated regenerations", () => {
    expect(computeNextContentVersion({ id: "xyz789", version: 3 })).toEqual({
      nextVersion: 4,
      supersedeId: "xyz789",
    });
  });
});

describe("isContentDraftAction", () => {
  it("recognizes content.draft actions", () => {
    expect(isContentDraftAction({ type: "content.draft" })).toBe(true);
  });

  it("rejects every other action type", () => {
    expect(isContentDraftAction({ type: "doc.rca_draft" })).toBe(false);
    expect(isContentDraftAction({ type: "email.draft_reply" })).toBe(false);
  });
});
