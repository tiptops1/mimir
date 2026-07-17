import { describe, expect, it } from "vitest";
import {
  buildExistingIndex,
  computeRowKey,
  placeholderSiret,
  planRow,
  registerPlanned,
  shouldSkipContact,
  siretStatus,
} from "./dedupe";
import { sliceBatches } from "./batch";

describe("siretStatus", () => {
  it("accepts 14 digits, tolerating spaces and dots", () => {
    expect(siretStatus("123 456 789 01234")).toEqual({ kind: "valid", siret: "12345678901234" });
    expect(siretStatus("123.456.789.01234")).toEqual({ kind: "valid", siret: "12345678901234" });
  });
  it("treats empty and [ND] as missing", () => {
    expect(siretStatus("")).toEqual({ kind: "missing" });
    expect(siretStatus("[ND]")).toEqual({ kind: "missing" });
  });
  it("rejects wrong lengths and letters", () => {
    expect(siretStatus("1234")).toEqual({ kind: "invalid", raw: "1234" });
    expect(siretStatus("ABC45678901234")).toEqual({ kind: "invalid", raw: "ABC45678901234" });
  });
});

describe("placeholderSiret", () => {
  it("is deterministic for the same normalized name + CP", () => {
    expect(placeholderSiret("Cabinet Durand SARL", "75001")).toBe(
      placeholderSiret("CABINET DURAND", "75001"),
    );
  });
  it("differs across names or postal codes", () => {
    expect(placeholderSiret("Cabinet Durand", "75001")).not.toBe(
      placeholderSiret("Cabinet Durand", "69001"),
    );
  });
  it("is IMPORT-prefixed (never collides with a real 14-digit SIRET)", () => {
    expect(placeholderSiret("Acme", "75001")).toMatch(/^IMPORT-[0-9a-f]{12}$/);
  });
});

describe("computeRowKey", () => {
  it("uses the real SIRET when valid", () => {
    expect(computeRowKey({ siret: "12345678901234" })).toEqual({
      ok: true,
      rowKey: "12345678901234",
      placeholder: false,
    });
  });
  it("errors on an invalid non-empty SIRET", () => {
    const r = computeRowKey({ siret: "999", nomSociete: "Acme" });
    expect(r.ok).toBe(false);
  });
  it("falls back to a placeholder from the name", () => {
    const r = computeRowKey({ nomSociete: "Cabinet Durand", codePostal: "75001" });
    expect(r).toEqual({
      ok: true,
      rowKey: placeholderSiret("Cabinet Durand", "75001"),
      placeholder: true,
    });
  });
  it("errors when neither SIRET nor a usable name exists", () => {
    expect(computeRowKey({}).ok).toBe(false);
    expect(computeRowKey({ nomSociete: "  " }).ok).toBe(false);
  });
});

describe("planRow", () => {
  const index = buildExistingIndex([
    {
      id: "id1",
      siret: "12345678901234",
      nomSociete: "Cabinet Durand Assurances",
      enseigne: null,
      siteWeb: "https://www.durand.fr/contact",
    },
  ]);

  it("skips an existing SIRET under the skip policy", () => {
    expect(planRow("12345678901234", {}, index, "skip")).toEqual({
      action: "SKIP",
      existingCompanyId: "id1",
      hints: [],
    });
  });
  it("updates an existing SIRET under fillEmpty", () => {
    expect(planRow("12345678901234", {}, index, "fillEmpty").action).toBe("UPDATE");
  });
  it("creates unknown keys, with name hints (never blocking)", () => {
    const plan = planRow(
      "IMPORT-abcdef123456",
      { nomSociete: "CABINET DURAND ASSURANCES SARL" },
      index,
      "skip",
    );
    expect(plan.action).toBe("CREATE");
    expect(plan.hints).toEqual([
      { kind: "name", companyId: "id1", label: "Cabinet Durand Assurances" },
    ]);
  });
  it("hints on matching website domain", () => {
    const plan = planRow("99999999999999", { siteWeb: "durand.fr" }, index, "skip");
    expect(plan.hints).toEqual([
      { kind: "domain", companyId: "id1", label: "Cabinet Durand Assurances" },
    ]);
  });
  it("converges duplicate rows within one file via registerPlanned", () => {
    registerPlanned(index, "IMPORT-samekey00000");
    const plan = planRow("IMPORT-samekey00000", {}, index, "skip");
    expect(plan.action).toBe("SKIP");
    expect(plan.existingCompanyId).toBeNull();
  });
});

describe("shouldSkipContact", () => {
  const existing = [
    { nom: "Durand", prenom: "Marie", email: "m.durand@acme.fr" },
    { nom: "Petit", prenom: null, email: null },
  ];
  it("skips on case-insensitive email match", () => {
    expect(shouldSkipContact({ email: " M.DURAND@acme.fr " }, existing)).toBe(true);
  });
  it("skips on nom+prenom fingerprint when no email", () => {
    expect(shouldSkipContact({ nom: "durand", prenom: "MARIE" }, existing)).toBe(true);
  });
  it("keeps genuinely new contacts", () => {
    expect(shouldSkipContact({ nom: "Nouveau", email: "n@x.fr" }, existing)).toBe(false);
  });
  it("never skips fully-anonymous contacts", () => {
    expect(shouldSkipContact({}, existing)).toBe(false);
  });
});

describe("sliceBatches", () => {
  it("slices evenly and keeps the remainder", () => {
    expect(sliceBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("handles empty input", () => {
    expect(sliceBatches([], 25)).toEqual([]);
  });
  it("rejects nonsense sizes", () => {
    expect(() => sliceBatches([1], 0)).toThrow();
  });
});
