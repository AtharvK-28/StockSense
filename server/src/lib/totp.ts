import crypto from "node:crypto";
import QRCode from "qrcode";
import speakeasy from "speakeasy";
import { env } from "../env";

const ALGORITHM = "aes-256-gcm";
const KEY = crypto.createHash("sha256").update(env.totpKey).digest();

export function encryptTotpSecret(secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptTotpSecret(value: string) {
  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("Invalid TOTP secret");
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
}

export function createTotpSecret() {
  return speakeasy.generateSecret({ length: 20 }).base32;
}

export function verifyTotp(secret: string, token: string) {
  return speakeasy.totp.verify({ secret, encoding: "base32", token, window: 1 });
}

export function totpUri(secret: string, email: string) {
  return speakeasy.otpauthURL({ secret, label: email, issuer: "StockSense", encoding: "base32" });
}

export function qrDataUrl(uri: string) {
  return QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 2, width: 240 });
}