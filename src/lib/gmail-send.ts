import { google } from "googleapis";
import { randomUUID } from "node:crypto";
import type { GoogleOAuthClient } from "./google-oauth";

// Outbound email over the Gmail API. The send scope (gmail.send) is already part
// of GOOGLE_SCOPES, so no re-consent is needed. We build a minimal RFC822 message
// ourselves (no compose library in the tree) and set our OWN Message-ID so the
// next Gmail sync dedupes the sent copy against the activity we log here
// (email-sync dedupes by RFC Message-ID).

/** RFC 2047 encoded-word (base64, UTF-8) for headers that may contain non-ASCII. */
function encodeHeaderWord(value: string): string {
  // Plain ASCII headers pass through unencoded.
  if (!/[^ -~]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export interface OutgoingEmail {
  fromName?: string | null;
  fromEmail: string;
  to: string;
  subject: string;
  body: string;
}

/** Build a raw RFC822 message + the Message-ID we stamped on it. */
export function buildMimeMessage(email: OutgoingEmail): {
  raw: string;
  messageId: string;
} {
  const domain = email.fromEmail.split("@")[1] || "mail.local";
  const messageId = `<${randomUUID()}@${domain}>`;
  const from = email.fromName
    ? `${encodeHeaderWord(email.fromName)} <${email.fromEmail}>`
    : email.fromEmail;
  // Base64 the body (76-char lines) so UTF-8 content survives transport intact.
  const bodyB64 = Buffer.from(email.body, "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");
  const headers = [
    `From: ${from}`,
    `To: ${email.to}`,
    `Subject: ${encodeHeaderWord(email.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  return { raw: `${headers.join("\r\n")}\r\n\r\n${bodyB64}`, messageId };
}

/** Send an email as the connected Google account. Returns the stamped Message-ID. */
export async function sendGmail(
  client: GoogleOAuthClient,
  email: OutgoingEmail,
): Promise<{ messageId: string; gmailId: string | null }> {
  const gmail = google.gmail({ version: "v1", auth: client });
  const { raw, messageId } = buildMimeMessage(email);
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: Buffer.from(raw, "utf8").toString("base64url") },
  });
  return { messageId, gmailId: res.data.id ?? null };
}
