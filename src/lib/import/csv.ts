// S13b — CSV parsing for the onboarding import pipeline. Pure (no DB, no I/O).
// Parser promoted from scripts/dedup-and-import.ts, generalized to a sniffed
// delimiter (French CRM/Excel exports are usually ";").

/** Strip a UTF-8 BOM if present (Excel exports carry one). */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * A file decoded as UTF-8 that wasn't UTF-8 (Windows-1252 exports) yields
 * U+FFFD replacement characters. Reject rather than silently mangle accents.
 */
export function looksNonUtf8(text: string): boolean {
  return text.includes("�");
}

/** Pick ";" or "," by counting occurrences outside quotes on the first line. */
export function sniffDelimiter(text: string): ";" | "," {
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] ?? "";
  let semis = 0;
  let commas = 0;
  let inQuotes = false;
  for (const c of firstLine) {
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && c === ";") semis++;
    else if (!inQuotes && c === ",") commas++;
  }
  return semis >= commas ? ";" : ",";
}

/** RFC-4180-ish parser: quoted fields, escaped quotes ("" → "), CR/LF/CRLF. */
export function parseCsv(text: string, delimiter: ";" | "," = ","): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      /* skip */
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: ";" | ",";
}

/**
 * Full pipeline for an uploaded file: BOM strip → delimiter sniff → parse →
 * header split → drop fully-empty trailing rows. Throws (French message —
 * surfaced verbatim in the wizard) on undecodable or headerless input.
 */
export function parseCsvWithHeader(text: string): ParsedCsv {
  const clean = stripBom(text);
  if (looksNonUtf8(clean)) {
    throw new Error(
      "Le fichier ne semble pas encodé en UTF-8. Réexportez-le en CSV UTF-8 (les exports Excel Windows utilisent souvent un autre encodage).",
    );
  }
  const delimiter = sniffDelimiter(clean);
  const all = parseCsv(clean, delimiter);
  const headers = all[0]?.map((h) => h.trim()) ?? [];
  if (headers.length === 0 || headers.every((h) => !h)) {
    throw new Error("Le fichier est vide ou n'a pas de ligne d'en-têtes.");
  }
  const rows = all
    .slice(1)
    .filter((r) => r.some((cell) => cell.trim().length > 0));
  return { headers, rows, delimiter };
}
