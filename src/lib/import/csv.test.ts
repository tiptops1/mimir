import { describe, expect, it } from "vitest";
import {
  looksNonUtf8,
  parseCsv,
  parseCsvWithHeader,
  sniffDelimiter,
  stripBom,
} from "./csv";

describe("stripBom", () => {
  it("removes a leading BOM", () => {
    expect(stripBom("﻿a;b")).toBe("a;b");
  });
  it("leaves clean text alone", () => {
    expect(stripBom("a;b")).toBe("a;b");
  });
});

describe("sniffDelimiter", () => {
  it("picks ; for French exports", () => {
    expect(sniffDelimiter("Raison sociale;SIRET;Ville\nAcme;123;Paris")).toBe(";");
  });
  it("picks , for comma files", () => {
    expect(sniffDelimiter("name,siret,city\nAcme,123,Paris")).toBe(",");
  });
  it("ignores delimiters inside quotes", () => {
    expect(sniffDelimiter('"a;b;c",x,y\n1,2,3')).toBe(",");
  });
});

describe("parseCsv", () => {
  it("parses quoted fields with embedded delimiter", () => {
    expect(parseCsv('"a;1";b\nc;d', ";")).toEqual([
      ["a;1", "b"],
      ["c", "d"],
    ]);
  });
  it("unescapes doubled quotes", () => {
    expect(parseCsv('"say ""hi""",x', ",")).toEqual([['say "hi"', "x"]]);
  });
  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\nc,d\r\n", ",")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
  it("handles multiline quoted fields", () => {
    expect(parseCsv('"line1\nline2",x', ",")).toEqual([["line1\nline2", "x"]]);
  });
});

describe("looksNonUtf8", () => {
  it("flags replacement characters", () => {
    expect(looksNonUtf8("soci�t�")).toBe(true);
    expect(looksNonUtf8("société")).toBe(false);
  });
});

describe("parseCsvWithHeader", () => {
  it("returns headers + data rows, dropping empty trailing rows", () => {
    const parsed = parseCsvWithHeader("﻿Nom;Ville\nAcme;Paris\n;\n");
    expect(parsed.delimiter).toBe(";");
    expect(parsed.headers).toEqual(["Nom", "Ville"]);
    expect(parsed.rows).toEqual([["Acme", "Paris"]]);
  });
  it("throws in French on non-UTF8 input", () => {
    expect(() => parseCsvWithHeader("Soci�t�;x\na;b")).toThrow(/UTF-8/);
  });
  it("throws on an empty file", () => {
    expect(() => parseCsvWithHeader("")).toThrow(/vide/);
  });
});
