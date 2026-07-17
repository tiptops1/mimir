import { describe, expect, it } from "vitest";
import type { FieldDef } from "@/lib/field-config";
import {
  buildTargetCatalog,
  mappingSchema,
  normalizeHeader,
  suggestMapping,
} from "./mapping";

const catalog = buildTargetCatalog({});

describe("normalizeHeader", () => {
  it("strips accents, case and punctuation", () => {
    expect(normalizeHeader("N° SIRET ")).toBe("n siret");
    expect(normalizeHeader("Étape / Pipeline")).toBe("etape pipeline");
  });
});

describe("suggestMapping", () => {
  it("matches exact French labels", () => {
    const [m] = suggestMapping(["Raison sociale"], catalog);
    expect(m.target).toEqual({ entity: "COMPANY", key: "nomSociete", source: "NATIVE" });
    expect(m.confidence).toBe(1);
  });
  it("matches synonyms with accents and punctuation", () => {
    const [m] = suggestMapping(["N° SIRET"], catalog);
    expect(m.target?.key).toBe("siret");
    expect(m.confidence).toBe(1);
  });
  it("matches prisma keys directly", () => {
    const [m] = suggestMapping(["codePostal"], catalog);
    expect(m.target?.key).toBe("codePostal");
  });
  it("leaves unknown headers unmapped", () => {
    const [m] = suggestMapping(["Couleur préférée du dirigeant"], catalog);
    expect(m.target).toBeNull();
    expect(m.confidence).toBeUndefined();
  });
  it("does not suggest the same target twice", () => {
    const [a, b] = suggestMapping(["Email (contact)", "E-mail"], catalog);
    expect(a.target?.key).toBe("email");
    expect(b.target?.key).not.toBe("email");
  });
  it("matches by token containment when unique", () => {
    const [m] = suggestMapping(["E-mail du contact principal"], catalog);
    expect(m.target?.key).toBe("email");
    expect(m.confidence).toBe(0.5);
  });
});

describe("buildTargetCatalog", () => {
  const customDef: FieldDef = {
    key: "logiciel_crm",
    label: "Logiciel CRM actuel",
    type: "text",
    options: [],
    required: false,
    order: 1,
    source: "CUSTOM",
    section: "Qualification",
  };
  it("includes tenant CUSTOM fields, matched by their label", () => {
    const cat = buildTargetCatalog({ COMPANY: [customDef] });
    const [m] = suggestMapping(["Logiciel CRM actuel"], cat);
    expect(m.target).toEqual({ entity: "COMPANY", key: "logiciel_crm", source: "CUSTOM" });
  });
  it("flags CUSTOM text fields as free text", () => {
    const cat = buildTargetCatalog({ COMPANY: [customDef] });
    expect(cat.find((t) => t.key === "logiciel_crm")?.freeText).toBe(true);
  });
  it("skips NATIVE FieldDefinitions (already in the catalog)", () => {
    const cat = buildTargetCatalog({
      COMPANY: [{ ...customDef, key: "siret", label: "SIRET", source: "NATIVE" }],
    });
    expect(cat.filter((t) => t.key === "siret")).toHaveLength(1);
  });
});

describe("mappingSchema", () => {
  const companyCol = {
    header: "SIRET",
    target: { entity: "COMPANY", key: "siret", source: "NATIVE" },
  };
  it("accepts a mapping with a company identifier", () => {
    const parsed = mappingSchema.safeParse({
      columns: [companyCol],
      options: { duplicatePolicy: "skip" },
    });
    expect(parsed.success).toBe(true);
  });
  it("rejects a mapping without any company-identifying column", () => {
    const parsed = mappingSchema.safeParse({
      columns: [{ header: "Email", target: { entity: "CONTACT", key: "email", source: "NATIVE" } }],
      options: { duplicatePolicy: "skip" },
    });
    expect(parsed.success).toBe(false);
  });
});
