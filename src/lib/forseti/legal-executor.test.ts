import { describe, expect, it } from "vitest";
import { computeNextLegalDocVersion, isLegalDocumentAction } from "./legal-executor";

describe("computeNextLegalDocVersion", () => {
  it("starts at version 1 with nothing to supersede when no prior ACTIVE row exists", () => {
    expect(computeNextLegalDocVersion(null)).toEqual({ nextVersion: 1, supersedeId: null });
  });

  it("increments the version and supersedes the prior ACTIVE row", () => {
    expect(computeNextLegalDocVersion({ id: "abc123", version: 1 })).toEqual({
      nextVersion: 2,
      supersedeId: "abc123",
    });
  });

  it("keeps incrementing across repeated resubmissions", () => {
    expect(computeNextLegalDocVersion({ id: "xyz789", version: 2 })).toEqual({
      nextVersion: 3,
      supersedeId: "xyz789",
    });
  });
});

describe("isLegalDocumentAction", () => {
  it("recognizes forseti.legal_document_draft actions", () => {
    expect(isLegalDocumentAction({ type: "forseti.legal_document_draft" })).toBe(true);
  });

  it("rejects every other action type", () => {
    expect(isLegalDocumentAction({ type: "forseti.compliance_task" })).toBe(false);
    expect(isLegalDocumentAction({ type: "content.draft" })).toBe(false);
  });
});
