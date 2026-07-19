import { describe, expect, it } from "vitest";
import { buildRenewalRetrievalQuery, parseRenewalOutput } from "./renewal";

describe("parseRenewalOutput", () => {
  it("parses a valid JSON draft", () => {
    expect(parseRenewalOutput('{"subject": "Objet", "body": "Corps"}')).toEqual({
      subject: "Objet",
      body: "Corps",
    });
  });

  it("strips a ```json fence", () => {
    expect(
      parseRenewalOutput('```json\n{"subject": "Objet", "body": "Corps"}\n```'),
    ).toEqual({ subject: "Objet", body: "Corps" });
  });

  it("fails closed on null input", () => {
    expect(parseRenewalOutput(null)).toBeNull();
  });

  it("fails closed on garbage", () => {
    expect(parseRenewalOutput("désolé, je ne peux pas")).toBeNull();
  });

  it("fails closed on a missing subject", () => {
    expect(parseRenewalOutput('{"body": "Corps"}')).toBeNull();
  });

  it("fails closed on an empty body", () => {
    expect(parseRenewalOutput('{"subject": "Objet", "body": ""}')).toBeNull();
  });
});

describe("buildRenewalRetrievalQuery", () => {
  const company = { companyId: "c1", companyName: "Acme Courtage" };

  it("joins company name, band, and signal labels", () => {
    const query = buildRenewalRetrievalQuery(company, {
      band: "at_risk",
      signals: [
        { key: "stale_contact", label: "Aucun contact récent", detail: "..." },
        { key: "negative_sentiment", label: "Dernier échange négatif", detail: "..." },
      ],
    });
    expect(query).toContain("Acme Courtage");
    expect(query).toContain("at_risk");
    expect(query).toContain("Aucun contact récent, Dernier échange négatif");
  });

  it("handles no signals", () => {
    const query = buildRenewalRetrievalQuery(company, { band: "critical", signals: [] });
    expect(query).toBe("Acme Courtage\n\ncritical");
  });

  it("caps the query length", () => {
    const query = buildRenewalRetrievalQuery(
      { companyId: "c1", companyName: "x".repeat(5000) },
      { band: "at_risk", signals: [] },
    );
    expect(query.length).toBe(1500);
  });
});
