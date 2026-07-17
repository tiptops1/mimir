// Mimisbrunnr chunker (S11) — pure and deterministic so the same source text
// always yields the same chunks (idempotent re-ingest, unit-testable, reused
// by the S13b import pipeline). Paragraph-first: split on blank lines, merge
// small paragraphs up to a target size, hard-split oversized ones with overlap
// so no passage exceeds the ceiling.

export interface ChunkOptions {
  /** Preferred chunk size in characters (merge paragraphs up to this). */
  target?: number;
  /** Hard ceiling — a single oversized paragraph is split at this length. */
  max?: number;
  /** Overlap carried between forced splits of an oversized paragraph. */
  overlap?: number;
}

const DEFAULTS: Required<ChunkOptions> = { target: 1200, max: 1600, overlap: 200 };

/** Split one oversized block at `max`, preferring sentence/word boundaries. */
function hardSplit(block: string, max: number, overlap: number): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < block.length) {
    let end = Math.min(start + max, block.length);
    if (end < block.length) {
      // Prefer breaking after a sentence end, then after a space.
      const window = block.slice(start, end);
      const sentence = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? "),
      );
      const space = window.lastIndexOf(" ");
      const cut = sentence > max * 0.5 ? sentence + 1 : space > max * 0.5 ? space : window.length;
      end = start + cut;
    }
    parts.push(block.slice(start, end).trim());
    if (end >= block.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return parts.filter((p) => p.length > 0);
}

/**
 * Chunk raw document text. Returns non-empty chunk strings in document order.
 */
export function chunkText(raw: string, options: ChunkOptions = {}): string[] {
  const { target, max, overlap } = { ...DEFAULTS, ...options };
  const paragraphs = raw
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.replace(/\s+\n/g, "\n").trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim().length > 0) chunks.push(current.trim());
    current = "";
  };

  for (const para of paragraphs) {
    if (para.length > max) {
      flush();
      chunks.push(...hardSplit(para, max, overlap));
      continue;
    }
    if (current.length > 0 && current.length + para.length + 2 > target) {
      flush();
    }
    current = current.length > 0 ? `${current}\n\n${para}` : para;
  }
  flush();

  return chunks;
}
