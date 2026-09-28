import type { Env } from "../env";

/** Sends through Resend when configured. Returns false when email is not set up so callers can fall back to showing a link. */
export async function sendEmail(env: Env, message: { to: string; subject: string; html: string }): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [message.to], subject: message.subject, html: message.html }),
  });
  return response.ok;
}

export function publicBaseUrl(env: Env, request: Request) {
  const configured = env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}
