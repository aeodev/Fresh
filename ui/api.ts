export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string | null = null,
  ) {
    super(message);
  }
}

/** Every call the UI makes. Same-origin, JSON in and out, cookie session. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? {} : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string | null } & T;
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`, data.code ?? null);
  return data;
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatDate(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleString() : "Unknown";
}

/** "Sep 29, 1:54 PM" */
export function formatShort(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Unknown";
}
