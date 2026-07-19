import { describe, expect, it } from "vitest";
import { buildLegalRetrievalQuery, parseLegalOutput, promptKeyForDocType } from "./legal-draft";

describe("parseLegalOutput", () => {
  it("parses a valid JSON draft", () => {
    expect(parseLegalOutput('{"title": "Titre", "body": "Corps"}')).toEqual({
      title: "Titre",
      body: "Corps",
    });
  });

  it("strips a ```json fence", () => {
    expect(
      parseLegalOutput('```json\n{"title": "Titre", "body": "Corps"}\n```'),
    ).toEqual({ title: "Titre", body: "Corps" });
  });

  it("fails closed on null input", () => {
    expect(parseLegalOutput(null)).toBeNull();
  });

  it("fails closed on garbage", () => {
    expect(parseLegalOutput("désolé, je ne peux pas")).toBeNull();
  });

  it("fails closed on a missing title", () => {
    expect(parseLegalOutput('{"body": "Corps"}')).toBeNull();
  });

  it("fails closed on an empty body", () => {
    expect(parseLegalOutput('{"title": "Titre", "body": ""}')).toBeNull();
  });
});

describe("promptKeyForDocType", () => {
  it("builds the dotted per-docType key", () => {
    expect(promptKeyForDocType("contract_review")).toBe("forseti.legal.draft.contract_review");
    expect(promptKeyForDocType("terms_draft")).toBe("forseti.legal.draft.terms_draft");
  });
});

describe("buildLegalRetrievalQuery", () => {
  it("trims whitespace", () => {
    expect(buildLegalRetrievalQuery("  Texte du contrat  ")).toBe("Texte du contrat");
  });

  it("caps the input length", () => {
    const query = buildLegalRetrievalQuery("x".repeat(10_000));
    expect(query.length).toBe(8000);
  });
});
