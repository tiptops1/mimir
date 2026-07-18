import { describe, expect, it } from "vitest";
import {
  buildRetrievalQuery,
  parseDraftOutput,
  parseSupportVerdict,
} from "./draft";

describe("parseSupportVerdict", () => {
  it("parses a plain JSON verdict", () => {
    const v = parseSupportVerdict(
      '{"support": true, "category": "sinistre", "confidence": 0.9, "reason": "claim follow-up"}',
    );
    expect(v).toEqual({
      support: true,
      category: "sinistre",
      confidence: 0.9,
      reason: "claim follow-up",
    });
  });

  it("strips a ```json fence", () => {
    const v = parseSupportVerdict('```json\n{"support": false}\n```');
    expect(v?.support).toBe(false);
    expect(v?.category).toBe("autre"); // schema default
  });

  it("fails closed on null, garbage, and schema violations", () => {
    expect(parseSupportVerdict(null)).toBeNull();
    expect(parseSupportVerdict("not json")).toBeNull();
    expect(parseSupportVerdict('{"support": "yes"}')).toBeNull();
    expect(parseSupportVerdict('{"support": true, "confidence": 2}')).toBeNull();
  });
});

describe("parseDraftOutput", () => {
  it("parses a fenced draft", () => {
    const d = parseDraftOutput('``` {"subject": "Re: devis", "body": "Bonjour,\\nMerci."} ```');
    expect(d).toEqual({ subject: "Re: devis", body: "Bonjour,\nMerci." });
  });

  it("fails closed on missing or empty fields", () => {
    expect(parseDraftOutput(null)).toBeNull();
    expect(parseDraftOutput('{"subject": "x"}')).toBeNull();
    expect(parseDraftOutput('{"subject": "", "body": "y"}')).toBeNull();
  });
});

describe("buildRetrievalQuery", () => {
  it("joins subject and body", () => {
    expect(
      buildRetrievalQuery({ fromEmail: "a@b.c", subject: "S", body: "B" }),
    ).toBe("S\n\nB");
  });

  it("caps the length", () => {
    const q = buildRetrievalQuery({
      fromEmail: "a@b.c",
      subject: "S",
      body: "x".repeat(5000),
    });
    expect(q.length).toBe(1500);
  });
});
