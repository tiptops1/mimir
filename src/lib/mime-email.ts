import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import type { Addr, ParsedEmail } from "./email-sync";

// Shared RFC822/MIME → ParsedEmail mapping. Used by the Gmail API sync
// (gmail-sync.ts), which fetches messages in raw form and feeds identical
// ParsedEmail shapes into the matching engine (email-sync.ts processEmail).
// Kept out of email-sync.ts so that file stays parser-agnostic and
// unit-testable.

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

/**
 * Bulk/automated-mail signature from the headers. These mark newsletters, mailing
 * lists, marketing blasts and machine notifications (Slack, Fireflies, ESPs like
 * Mailchimp/SendGrid) — i.e. mail the CRM should never turn into a contact.
 */
function detectBulk(m: ParsedMail): boolean {
  const h = m.headers;
  // List management ⇒ mailing list or marketing blast.
  if (h.has("list-unsubscribe") || h.has("list-id") || h.has("list-post")) return true;
  const precedence = String(h.get("precedence") ?? "").toLowerCase();
  if (precedence === "bulk" || precedence === "list" || precedence === "junk") return true;
  // RFC 3834 auto-generated/auto-replied system mail.
  const auto = String(h.get("auto-submitted") ?? "").toLowerCase();
  if (auto && auto !== "no") return true;
  // Bulk-ESP fingerprints (feedback loops / complaint headers).
  if (h.has("feedback-id") || h.has("x-csa-complaints") || h.has("x-mailgun-sid"))
    return true;
  return false;
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
    bulk: detectBulk(m),
  };
}

/** Parse raw RFC822 bytes (e.g. Gmail API `format=raw`) into a ParsedEmail. */
export async function parseRawEmail(source: Buffer | string): Promise<ParsedEmail> {
  return toParsedEmail(await simpleParser(source));
}
