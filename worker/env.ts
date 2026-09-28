import type { ConversationObject } from "./conversations/object";

/** Bindings and secrets the Worker runs with. Secrets come from .dev.vars locally and `wrangler secret put` in production. */
export type Env = {
  DB: D1Database;
  CONVERSATIONS: DurableObjectNamespace<ConversationObject>;
  ASSETS?: Fetcher;
  APP_NAME: string;
  OPENAI_API_KEY?: string;
  OPENAI_ANSWER_MODEL?: string;
  OPENAI_EMBEDDING_MODEL?: string;
  OPENAI_DAILY_REQUEST_LIMIT?: string;
  ENCRYPTION_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  PUBLIC_BASE_URL?: string;
};
