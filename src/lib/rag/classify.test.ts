import { describe, expect, it } from "vitest";
import {
  parseVerdicts,
  partitionByVerdict,
  sha256,
  verdictArraySchema,
  type Verdict,
} from "./classify";

// Health-flavored fixtures (D3 exit criterion) — the tone of a French courtier
// knowledge base, mixing clean product/process content with the kind of
// personal health data the classifier must keep out of storage.

const CLEAN_CHUNKS = [
  {
    seq: 0,
    text: "La garantie prévoyance collective couvre l'incapacité, l'invalidité et le décès. Les cotisations sont exprimées en pourcentage du salaire brut, réparties employeur/salarié selon l'accord de branche.",
  },
  {
    seq: 1,
    text: "Procédure de renouvellement : envoyer l'appel de cotisation 60 jours avant l'échéance, relancer à 30 jours, clôturer le dossier dans l'outil de gestion.",
  },
];

const HEALTH_CHUNKS = [
  {
    seq: 2,
    text: "Questionnaire médical de M. Bernard : diabète de type 2 diagnostiqué en 2019, traitement par metformine, hospitalisation en mars 2024.",
  },
  {
    seq: 3,
    text: "Mme Dubois est en arrêt de travail depuis janvier suite à une dépression ; son dossier d'invalidité catégorie 2 est en cours d'instruction.",
  },
];

const verdict = (i: number, flag: boolean, categories: string[] = []): Verdict => ({
  i,
  flag,
  categories,
  confidence: 0.9,
  reason: flag ? "donnée de santé personnelle" : "",
});

describe("verdict schema", () => {
  it("parses a valid classifier reply", () => {
    const raw = JSON.stringify([
      { i: 0, flag: false, categories: [], confidence: 0.97, reason: "" },
      { i: 1, flag: true, categories: ["questionnaire_medical"], confidence: 0.99, reason: "questionnaire" },
    ]);
    const parsed = parseVerdicts(raw);
    expect(parsed).not.toBeNull();
    expect(parsed![1].flag).toBe(true);
  });

  it("parses replies wrapped in a code fence", () => {
    const raw = '```json\n[{"i":0,"flag":false}]\n```';
    const parsed = parseVerdicts(raw);
    expect(parsed).toEqual([{ i: 0, flag: false, categories: [], confidence: 1, reason: "" }]);
  });

  it("returns null (fail closed) on malformed output", () => {
    expect(parseVerdicts("Je ne peux pas classifier ces extraits.")).toBeNull();
    expect(parseVerdicts('{"i":0}')).toBeNull(); // object, not array
    expect(parseVerdicts(null)).toBeNull();
    expect(verdictArraySchema.safeParse([{ i: -1, flag: true }]).success).toBe(false);
  });
});

describe("partitionByVerdict — the quarantine decision", () => {
  const chunks = [...CLEAN_CHUNKS, ...HEALTH_CHUNKS]; // batch indexes 0..3

  it("routes flagged chunks to quarantine and clean chunks to storage", () => {
    const verdicts = [
      verdict(0, false),
      verdict(1, false),
      verdict(2, true, ["questionnaire_medical", "pathologie"]),
      verdict(3, true, ["arret_travail"]),
    ];
    const { clean, flagged } = partitionByVerdict(chunks, verdicts);
    expect(clean.map((c) => c.seq)).toEqual([0, 1]);
    expect(flagged.map((f) => f.seq)).toEqual([2, 3]);
    expect(flagged[0].verdict.categories).toContain("questionnaire_medical");
  });

  it("quarantine payload carries hash + verdict and NEVER the text", () => {
    const verdicts = [verdict(0, false), verdict(1, false), verdict(2, true), verdict(3, true)];
    const { flagged } = partitionByVerdict(chunks, verdicts);
    for (const f of flagged) {
      const serialized = JSON.stringify(f);
      expect(serialized).not.toContain("Bernard");
      expect(serialized).not.toContain("diabète");
      expect(serialized).not.toContain("Dubois");
      expect(serialized).not.toContain("dépression");
      expect(f.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(flagged[0].contentHash).toBe(sha256(HEALTH_CHUNKS[0].text));
  });

  it("fails closed when the whole batch has no verdicts (null)", () => {
    const { clean, flagged } = partitionByVerdict(chunks, null);
    expect(clean).toEqual([]);
    expect(flagged).toHaveLength(4);
    expect(flagged.every((f) => f.verdict.flag)).toBe(true);
    expect(flagged[0].verdict.categories).toContain("unverified");
  });

  it("fails closed for a chunk whose verdict is missing from the array", () => {
    const verdicts = [verdict(0, false), verdict(2, true)]; // 1 and 3 missing
    const { clean, flagged } = partitionByVerdict(chunks, verdicts);
    expect(clean.map((c) => c.seq)).toEqual([0]);
    expect(flagged.map((f) => f.seq).sort()).toEqual([1, 2, 3]);
  });

  it("a mixed document keeps its clean chunks — quarantine is per-chunk, not per-doc", () => {
    const mixed = [CLEAN_CHUNKS[0], HEALTH_CHUNKS[0]];
    const verdicts = [verdict(0, false), verdict(1, true, ["pathologie"])];
    const { clean, flagged } = partitionByVerdict(mixed, verdicts);
    expect(clean).toHaveLength(1);
    expect(clean[0].text).toContain("prévoyance collective");
    expect(flagged).toHaveLength(1);
  });
});
