import { base64ToBytes } from "../lib/crypto";

function pemToDer(pem: string) {
  const body = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  return base64ToBytes(body);
}

/** Freshchat signs the raw JSON body with SHA256withRSA; the public key is shown in Admin → Webhooks. */
export async function verifyFreshchatSignature(publicKeyPem: string, rawBody: string, signatureBase64: string) {
  try {
    const key = await crypto.subtle.importKey("spki", pemToDer(publicKeyPem) as BufferSource, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64ToBytes(signatureBase64.trim()) as BufferSource, new TextEncoder().encode(rawBody));
  } catch {
    return false;
  }
}
