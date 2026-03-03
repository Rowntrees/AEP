import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "crypto";

const ALGORITHM = "aes-256-gcm";

function getMasterKey(): Buffer {
  const key = process.env.MASTER_KEY;
  if (!key) throw new Error("MASTER_KEY env var is not set");
  if (key.length !== 64)
    throw new Error("MASTER_KEY must be 64 hex chars (32 bytes)");
  return Buffer.from(key, "hex");
}

export function encryptApiKey(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getMasterKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Store as iv:tag:ciphertext (all hex)
  return [iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(
    ":"
  );
}

export function decryptApiKey(blob: string): string {
  const parts = blob.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted blob format");
  const [ivHex, tagHex, encHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const encrypted = Buffer.from(encHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, getMasterKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

export function generateManagementToken(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateAgentId(): string {
  return randomBytes(8).toString("hex");
}
