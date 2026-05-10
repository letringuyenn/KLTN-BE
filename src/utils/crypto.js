const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const ENCRYPTED_PREFIX = "enc";

function getEncryptionKey() {
  const rawKey = process.env.ENCRYPTION_KEY;

  if (!rawKey) {
    throw new Error("ENCRYPTION_KEY environment variable is required");
  }

  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, "hex");
  }

  try {
    const base64Key = Buffer.from(rawKey, "base64");
    if (base64Key.length === 32) {
      return base64Key;
    }
  } catch (error) {
    // Ignore base64 parsing errors and continue with utf8 length check.
  }

  const utf8Key = Buffer.from(rawKey, "utf8");
  if (utf8Key.length === 32) {
    return utf8Key;
  }

  throw new Error(
    "ENCRYPTION_KEY must be 32 bytes (utf8), 64-char hex, or base64-encoded 32-byte key",
  );
}

function encryptString(plainText) {
  if (typeof plainText !== "string" || plainText.length === 0) {
    throw new Error("encryptString expects a non-empty string");
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptString(cipherPayload) {
  if (typeof cipherPayload !== "string" || cipherPayload.length === 0) {
    throw new Error("decryptString expects a non-empty string");
  }

  const parts = cipherPayload.split(":");
  if (parts.length !== 4 || parts[0] !== ENCRYPTED_PREFIX) {
    throw new Error("Invalid encrypted payload format");
  }

  const [, ivB64, authTagB64, encryptedB64] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const encrypted = Buffer.from(encryptedB64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

function isEncryptedString(value) {
  return typeof value === "string" && value.startsWith(`${ENCRYPTED_PREFIX}:`);
}

module.exports = {
  encryptString,
  decryptString,
  isEncryptedString,
};
