import { createHmac, timingSafeEqual } from "node:crypto";

// Stateless unsubscribe tokens for the cold-email opt-out link (RGPD). Token =
// base64url("tenantId.enrollmentId.HMAC(payload)") — the public route can
// verify + resolve the tenant with no session and no extra model. HMAC key is
// derived from ENCRYPTION_KEY (same secret that guards the control plane), so
// a token can't be forged to opt someone else out (or enumerate enrollments).
// No "server-only" guard: probe/test scripts (tsx) exercise this too.

function hmacKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  // Domain-separated derivation — never use the AES key bytes directly.
  return createHmac("sha256", Buffer.from(raw, "base64"))
    .update("outreach-unsubscribe-v1")
    .digest();
}

function sign(payload: string): string {
  return createHmac("sha256", hmacKey()).update(payload).digest("base64url");
}

/** Mint the opt-out token for one enrollment. */
export function mintUnsubscribeToken(
  tenantId: string,
  enrollmentId: string,
): string {
  const payload = `${tenantId}.${enrollmentId}`;
  return Buffer.from(`${payload}.${sign(payload)}`, "utf8").toString("base64url");
}

/** Verify a token; returns its ids or null if malformed/tampered. */
export function verifyUnsubscribeToken(
  token: string,
): { tenantId: string; enrollmentId: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const parts = decoded.split(".");
  if (parts.length !== 3) return null;
  const [tenantId, enrollmentId, mac] = parts;
  if (!tenantId || !enrollmentId || !mac) return null;
  const expected = sign(`${tenantId}.${enrollmentId}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { tenantId, enrollmentId };
}

/** Absolute opt-out URL for one enrollment (goes in the mail footer + header). */
export function unsubscribeUrl(tenantId: string, enrollmentId: string): string {
  const base = process.env.APP_URL || "http://localhost:3000";
  const token = mintUnsubscribeToken(tenantId, enrollmentId);
  return `${base.replace(/\/$/, "")}/api/outreach/unsubscribe?t=${token}`;
}

/** The plain-text footer appended to every outreach email body. */
export function unsubscribeFooter(
  tenantId: string,
  enrollmentId: string,
  text: string,
): string {
  return `\n\n—\n${text} ${unsubscribeUrl(tenantId, enrollmentId)}`;
}
