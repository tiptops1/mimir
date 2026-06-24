import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import type { Addr, ParsedEmail } from "./email-sync";

// Shared RFC822/MIME → ParsedEmail mapping. Used by both the legacy IMAP sync
// (imap-sync.ts) and the Gmail API sync (gmail-sync.ts), which fetches messages
// in raw form — so both feed identical ParsedEmail shapes into the matching
// engine (email-sync.ts processEmail). Kept out of email-sync.ts so that file
// stays parser-agnostic and unit-testable.

function addrList(a: AddressObject | AddressObject[] | undefined): Addr[] {
  if (!a) return [];
  const arr = Array.isArray(a) ? a : [a];
  const out: Addr[] = [];
  for (const obj of arr) {
    for (const v of obj.value ?? []) {
      if (v.address) out.push({ address: v.address, name: v.name || null });
    }
  }
  return out;
}

export function toParsedEmail(m: ParsedMail): ParsedEmail {
  const text = (m.text ?? "").replace(/\r\n/g, "\n");
  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 280) || null;
  // Strip quoted reply chains so the AI pass focuses on the new message.
  const body =
    text
      .split(/\n>+|\nLe .* a écrit :|\nOn .* wrote:/)[0]
      .trim()
      .slice(0, 8000) || null;
  return {
    messageId: m.messageId ?? null,
    date: m.date ?? new Date(),
    subject: m.subject ?? null,
    from: addrList(m.from),
    to: addrList(m.to),
    cc: addrList(m.cc),
    snippet,
    body,
  };
}

/** Parse raw RFC822 bytes (e.g. Gmail API `format=raw`) into a ParsedEmail. */
export async function parseRawEmail(source: Buffer | string): Promise<ParsedEmail> {
  return toParsedEmail(await simpleParser(source));
}
