// The only place that talks to the Freshchat API. Five calls, one error type.
// Docs: https://developers.freshchat.com/api/

export type FreshchatAgent = {
  id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  availability_status?: string;
  is_deactivated?: boolean;
  is_deleted?: boolean;
};

export type FreshchatConversation = {
  conversation_id: string;
  app_id?: string;
  user_id?: string;
  assigned_agent_id?: string;
  assigned_group_id?: string;
  channel_id?: string;
  status?: string; // new | assigned | resolved | reopened
  url?: string;
};

export type FreshchatMessagePart = { text?: { content?: string } } & Record<string, unknown>;

export type FreshchatMessage = {
  id: string;
  conversation_id?: string;
  actor_type?: string; // user | agent | bot | system
  actor_id?: string;
  message_type?: string; // normal | private
  created_time?: string;
  message_parts?: FreshchatMessagePart[];
};

export type FreshchatUser = { id: string; first_name?: string; last_name?: string; email?: string };

export class FreshchatError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
  get retryable() {
    return this.status === 429 || this.status >= 500;
  }
}

/** Accepts "acme.freshchat.com", "https://acme.freshchat.com", or a full /v2 URL and returns the canonical https://host/v2. */
export function normalizeBaseUrl(input: string) {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Enter your Freshchat API URL, for example https://yourcompany.freshchat.com");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("That does not look like a URL.");
  }
  const host = url.hostname.toLowerCase();
  const isLocalMock = host === "localhost" || host === "127.0.0.1"; // scripts/mock-freshchat.mjs
  if (isLocalMock) return `${url.protocol}//${url.host}/v2`;
  if (url.protocol !== "https:" || !(host.endsWith(".freshchat.com") || host.endsWith(".myfreshworks.com") || host.endsWith(".freshworks.com"))) {
    throw new Error("The URL must be your Freshchat domain (…freshchat.com or …myfreshworks.com).");
  }
  const path = url.pathname.replace(/\/+$/, "");
  return `https://${host}${path.endsWith("/v2") ? path : `${path}/v2`}`;
}

export function extractText(parts: FreshchatMessagePart[] | undefined) {
  return (parts ?? [])
    .map((part) => (typeof part.text?.content === "string" ? part.text.content : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function agentDisplayName(agent: FreshchatAgent) {
  return [agent.first_name, agent.last_name].filter(Boolean).join(" ").trim() || agent.email || agent.id;
}

export class FreshchatClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return (await response.json().catch(() => ({}))) as T;
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      return this.request<T>(path, init, attempt + 1);
    }
    const detail = await response.text().catch(() => "");
    throw new FreshchatError(response.status, `Freshchat ${init.method ?? "GET"} ${path} failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }

  async listAgents(): Promise<FreshchatAgent[]> {
    const agents: FreshchatAgent[] = [];
    for (let page = 1; page <= 5; page += 1) {
      const data = await this.request<{ agents?: FreshchatAgent[]; pagination?: { total_pages?: number } }>(`/agents?page=${page}&items_per_page=100`);
      agents.push(...(data.agents ?? []));
      if (page >= (data.pagination?.total_pages ?? 1) || !(data.agents ?? []).length) break;
    }
    return agents.filter((a) => !a.is_deleted && !a.is_deactivated);
  }

  getConversation(conversationId: string) {
    return this.request<FreshchatConversation>(`/conversations/${encodeURIComponent(conversationId)}`);
  }

  /**
   * Latest messages in chronological order. Freshchat pages 50 at a time; we read up to
   * `pages` pages and dedupe, so a burst that arrived across pages is still complete.
   */
  async getMessages(conversationId: string, pages = 2): Promise<FreshchatMessage[]> {
    const seen = new Map<string, FreshchatMessage>();
    for (let page = 1; page <= pages; page += 1) {
      const data = await this.request<{ messages?: FreshchatMessage[]; link?: { rel?: string; href?: string } }>(
        `/conversations/${encodeURIComponent(conversationId)}/messages?page=${page}&items_per_page=50`,
      );
      const messages = data.messages ?? [];
      for (const message of messages) if (message.id) seen.set(message.id, message);
      if (messages.length < 50 || !data.link?.href) break;
    }
    return [...seen.values()].sort((a, b) => String(a.created_time ?? "").localeCompare(String(b.created_time ?? "")));
  }

  getUser(userId: string) {
    return this.request<FreshchatUser>(`/users/${encodeURIComponent(userId)}`);
  }

  /** Posts as the configured reply agent so the customer sees a named person, not "bot". */
  sendMessage(conversationId: string, input: { text: string; actorId: string; messageType?: "normal" | "private" }) {
    return this.request<FreshchatMessage>(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: JSON.stringify({
        message_parts: [{ text: { content: input.text.slice(0, 4000) } }],
        message_type: input.messageType ?? "normal",
        actor_type: "agent",
        actor_id: input.actorId,
      }),
    });
  }

  updateConversation(conversationId: string, body: { status?: "assigned" | "resolved" | "reopened"; assigned_agent_id?: string }) {
    return this.request<FreshchatConversation>(`/conversations/${encodeURIComponent(conversationId)}`, { method: "PUT", body: JSON.stringify(body) });
  }
}
