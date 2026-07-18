import { describe, expect, it } from "vitest";
import { buildSectionRetrievalQuery, parseRcaSectionOutput } from "./draft";

describe("parseRcaSectionOutput", () => {
  it("parses a plain JSON section", () => {
    const s = parseRcaSectionOutput('{"content": "Le client a signalé un retard."}');
    expect(s).toEqual({ content: "Le client a signalé un retard." });
  });

  it("strips a ```json fence", () => {
    const s = parseRcaSectionOutput('```json\n{"content": "Cause probable : X."}\n```');
    expect(s?.content).toBe("Cause probable : X.");
  });

  it("fails closed on null, garbage, and schema violations", () => {
    expect(parseRcaSectionOutput(null)).toBeNull();
    expect(parseRcaSectionOutput("not json")).toBeNull();
    expect(parseRcaSectionOutput('{"content": ""}')).toBeNull();
    expect(parseRcaSectionOutput('{"wrong_key": "x"}')).toBeNull();
  });
});

describe("buildSectionRetrievalQuery", () => {
  const activity = { summary: "Résumé", body: "Corps", sentiment: "NEUTRE" };

  it("joins the section label, summary, and body", () => {
    expect(buildSectionRetrievalQuery(activity, "Cause racine")).toBe(
      "Cause racine\n\nRésumé\n\nCorps",
    );
  });

  it("caps the length", () => {
    const q = buildSectionRetrievalQuery(
      { ...activity, body: "x".repeat(5000) },
      "Impact",
    );
    expect(q.length).toBe(1500);
  });
});
