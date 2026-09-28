// Password hashing (PBKDF2), random tokens, and AES-GCM for secrets at rest. WebCrypto only.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomToken(bytes = 32) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return bytesToBase64(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(left: string, right: string) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return mismatch === 0;
}

const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iterations, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterations || !saltB64 || !hashB64) return false;
  const hash = await pbkdf2(password, base64ToBytes(saltB64), Number(iterations));
  return constantTimeEqual(bytesToBase64(hash), hashB64);
}

async function aesKey(keyB64: string) {
  const raw = base64ToBytes(keyB64);
  if (raw.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64 encoded.");
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Encrypts when ENCRYPTION_KEY is configured; otherwise stores with a `plain:` marker so it is obvious. */
export async function encryptSecret(plain: string, keyB64?: string) {
  if (!keyB64) return `plain:${plain}`;
  const key = await aesKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, encoder.encode(plain));
  return `enc:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(stored: string, keyB64?: string) {
  if (stored.startsWith("plain:")) return stored.slice("plain:".length);
  if (!stored.startsWith("enc:")) return stored;
  if (!keyB64) throw new Error("This secret is encrypted but ENCRYPTION_KEY is not set.");
  const [, ivB64, cipherB64] = stored.split(":");
  const key = await aesKey(keyB64);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivB64) as BufferSource }, key, base64ToBytes(cipherB64) as BufferSource);
  return decoder.decode(plain);
}

export function maskSecret(value: string) {
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
