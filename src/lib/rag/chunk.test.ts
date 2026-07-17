import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk";

const para = (n: number, len = 300) =>
  `Paragraphe ${n}. ${"Le cabinet accompagne ses clients courtiers. ".repeat(Math.ceil(len / 46))}`.slice(0, len);

describe("chunkText", () => {
  it("returns [] for empty or whitespace-only input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("  \n\n  \n")).toEqual([]);
  });

  it("keeps a single small paragraph as one chunk", () => {
    const chunks = chunkText("Bonjour, ceci est un court document.");
    expect(chunks).toEqual(["Bonjour, ceci est un court document."]);
  });

  it("merges small paragraphs up to the target size", () => {
    const text = [para(1), para(2), para(3), para(4), para(5), para(6)].join("\n\n");
    const chunks = chunkText(text, { target: 1200, max: 1600, overlap: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    // Merged chunks contain paragraph boundaries, and none exceeds the ceiling.
    expect(chunks.some((c) => c.includes("\n\n"))).toBe(true);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1600);
  });

  it("hard-splits one giant paragraph with overlap, respecting max", () => {
    const giant = "Phrase utile sur les contrats de prévoyance collective. ".repeat(100); // ~5600 chars
    const chunks = chunkText(giant, { target: 1200, max: 1600, overlap: 200 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1600);
    // Overlap: consecutive pieces share content.
    const tail = chunks[0].slice(-50);
    expect(chunks[1]).toContain(tail.trim().split(" ").slice(1).join(" "));
  });

  it("is deterministic — same input, same chunks", () => {
    const text = [para(1), para(2), para(3)].join("\n\n");
    expect(chunkText(text)).toEqual(chunkText(text));
  });

  it("preserves document order", () => {
    const text = [para(1, 900), para(2, 900), para(3, 900)].join("\n\n");
    const chunks = chunkText(text);
    const i1 = chunks.findIndex((c) => c.includes("Paragraphe 1"));
    const i3 = chunks.findIndex((c) => c.includes("Paragraphe 3"));
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i3).toBeGreaterThan(i1);
  });
});
