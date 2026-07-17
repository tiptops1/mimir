import { describe, expect, it } from "vitest";
import { buildTargetCatalog, mappingSchema } from "./mapping";
import {
  buildRowPayloads,
  clean,
  freeTextKeys,
  stageKeyFromLabel,
  toBool,
  toDate,
  toInt,
} from "./coerce";

const STAGES = [
  { key: "A_QUALIFIER", label: "À qualifier" },
  { key: "RDV_OBTENU", label: "RDV obtenu" },
  { key: "GAGNE", label: "Gagné" },
];

describe("clean", () => {
  it("nulls empty and [ND] cells", () => {
    expect(clean("  ")).toBeNull();
    expect(clean("[ND]")).toBeNull();
    expect(clean(" x ")).toBe("x");
    expect(clean(undefined)).toBeNull();
  });
});

describe("toDate", () => {
  it("parses French dd/mm/yyyy", () => {
    expect(toDate("14/03/2025")?.toISOString()).toBe("2025-03-14T00:00:00.000Z");
  });
  it("parses two-digit years", () => {
    expect(toDate("01/02/24")?.toISOString()).toBe("2024-02-01T00:00:00.000Z");
  });
  it("rejects impossible French dates", () => {
    expect(toDate("32/01/2025")).toBeNull();
  });
  it("still accepts ISO dates", () => {
    expect(toDate("2025-03-14")?.getUTCFullYear()).toBe(2025);
  });
});

describe("toInt", () => {
  it("handles spaces and euro signs", () => {
    expect(toInt("1 200 €")).toBe(1200);
  });
  it("drops decimal parts", () => {
    expect(toInt("1200,50")).toBe(1200);
  });
  it("nulls non-numeric", () => {
    expect(toInt("beaucoup")).toBeNull();
  });
});

describe("toBool", () => {
  it("accepts French affirmatives", () => {
    expect(toBool("Oui")).toBe(true);
    expect(toBool("Non")).toBe(false);
    expect(toBool("")).toBe(false);
  });
});

describe("stageKeyFromLabel", () => {
  it("matches labels ignoring accents and case", () => {
    expect(stageKeyFromLabel("gagne", STAGES)).toBe("GAGNE");
    expect(stageKeyFromLabel("À QUALIFIER", STAGES)).toBe("A_QUALIFIER");
  });
  it("matches the key itself", () => {
    expect(stageKeyFromLabel("RDV_OBTENU", STAGES)).toBe("RDV_OBTENU");
  });
  it("returns null for unknown labels", () => {
    expect(stageKeyFromLabel("En négociation", STAGES)).toBeNull();
  });
});

describe("buildRowPayloads", () => {
  const catalog = buildTargetCatalog({
    COMPANY: [
      {
        key: "logiciel_crm",
        label: "Logiciel CRM",
        type: "text",
        options: [],
        required: false,
        order: 1,
        source: "CUSTOM",
        section: "Qualification",
      },
    ],
  });
  const mapping = mappingSchema.parse({
    columns: [
      { header: "SIRET", target: { entity: "COMPANY", key: "siret", source: "NATIVE" } },
      { header: "Société", target: { entity: "COMPANY", key: "nomSociete", source: "NATIVE" } },
      { header: "Étape", target: { entity: "COMPANY", key: "stage", source: "NATIVE" } },
      { header: "CA", target: { entity: "COMPANY", key: "chiffreAffaires", source: "NATIVE" } },
      { header: "Notes", target: { entity: "COMPANY", key: "notes", source: "NATIVE" } },
      { header: "Logiciel", target: { entity: "COMPANY", key: "logiciel_crm", source: "CUSTOM" } },
      { header: "Email", target: { entity: "CONTACT", key: "email", source: "NATIVE" } },
      { header: "Ignorée", target: null },
    ],
    options: { duplicatePolicy: "skip" },
  });

  it("routes NATIVE and CUSTOM values to the right buckets", () => {
    const p = buildRowPayloads(
      ["12345678901234", "Acme", "Gagné", "1 200 €", "RAS", "HubSpot", "a@b.fr", "zzz"],
      mapping.columns,
      catalog,
      STAGES,
    );
    expect(p.company).toEqual({
      siret: "12345678901234",
      nomSociete: "Acme",
      stage: "GAGNE",
      chiffreAffaires: 1200,
      notes: "RAS",
    });
    expect(p.companyCustom).toEqual({ logiciel_crm: "HubSpot" });
    expect(p.contact).toEqual({ email: "a@b.fr" });
    expect(p.errors).toEqual([]);
  });

  it("collects free-text values for the health classifier", () => {
    const p = buildRowPayloads(
      ["1", "Acme", "", "", "note sensible", "HubSpot", "", ""],
      mapping.columns,
      catalog,
      STAGES,
    );
    expect(p.textFields).toEqual(["note sensible", "HubSpot"]);
  });

  it("skips empty cells entirely", () => {
    const p = buildRowPayloads(
      ["", "Acme", "", "[ND]", "", "", "", ""],
      mapping.columns,
      catalog,
      STAGES,
    );
    expect(p.company).toEqual({ nomSociete: "Acme" });
  });

  it("reports unknown targets as row errors", () => {
    const badColumns = [
      { header: "X", target: { entity: "COMPANY" as const, key: "nexiste_pas", source: "NATIVE" as const } },
    ];
    const p = buildRowPayloads(["v"], badColumns, catalog, STAGES);
    expect(p.errors).toHaveLength(1);
  });
});

describe("freeTextKeys", () => {
  it("lists mapped free-text targets", () => {
    const catalog = buildTargetCatalog({});
    const keys = freeTextKeys(
      [
        { header: "Notes", target: { entity: "COMPANY", key: "notes", source: "NATIVE" } },
        { header: "SIRET", target: { entity: "COMPANY", key: "siret", source: "NATIVE" } },
      ],
      catalog,
    );
    expect(keys).toEqual([{ entity: "COMPANY", key: "notes", source: "NATIVE" }]);
  });
});
