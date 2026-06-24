import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM symmetric encryption for secrets stored at rest in the control
// plane (tenant connection strings now; per-tenant integration credentials in
// Phase 3). No "server-only" guard so the provisioning scripts (tsx) can reuse it.
//
// ENCRYPTION_KEY = 32 random bytes, base64-encoded. Generate with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to 32 bytes (base64-encoded)");
  }
  return key;
}

/** Encrypt a UTF-8 string. Returns `iv:authTag:ciphertext`, all base64. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/** Reverse of {@link encrypt}. Throws if the payload was tampered with. */
export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed ciphertext");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
