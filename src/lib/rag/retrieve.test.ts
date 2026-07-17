import { describe, expect, it } from "vitest";
import { toPassage } from "./retrieve";

describe("toPassage", () => {
  it("shapes a raw vectorSearch hit into the AgentAction.sources contract", () => {
    const passage = toPassage({
      _id: "507f1f77bcf86cd799439011",
      docId: "507f1f77bcf86cd799439022",
      text: "La garantie prévoyance collective couvre l'incapacité.",
      score: 0.87,
    });
    expect(passage).toEqual({
      docId: "507f1f77bcf86cd799439022",
      chunkId: "507f1f77bcf86cd799439011",
      text: "La garantie prévoyance collective couvre l'incapacité.",
      score: 0.87,
    });
  });

  it("unwraps a raw Mongo { $oid } id shape", () => {
    const passage = toPassage({
      _id: { $oid: "507f1f77bcf86cd799439011" },
      docId: { $oid: "507f1f77bcf86cd799439022" },
      text: "chunk text",
      score: 0.5,
    });
    expect(passage.chunkId).toBe("507f1f77bcf86cd799439011");
    expect(passage.docId).toBe("507f1f77bcf86cd799439022");
  });
});
