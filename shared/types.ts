// Types shared by the Worker and the UI. Everything the API returns is described here.
import type { Role } from "./rbac";

export type AgentMode = "off" | "shadow" | "live";
export type ConversationState = "agent" | "human" | "resolved";
export type TurnDecision = "sent" | "shadow" | "handoff" | "error";

export type User = { id: string; email: string; name: string; createdAt: string };

export type CompanySummary = {
  id: string;
  slug: string;
  name: string;
  role: Role;
  mode: AgentMode;
  createdAt: string;
};

export type SetupStatus = {
  connected: boolean;
  replyAgentSet: boolean;
  knowledgeActive: boolean;
  sidebarTokenIssued: boolean;
  goldenTestsPassing: boolean | null; // null = never run
  mode: AgentMode;
};

export type CompanyDetail = CompanySummary & {
  setup: SetupStatus;
  stats: { conversationsToday: number; sentToday: number; handoffsToday: number; humanNow: number };
};

export type Member = { userId: string; email: string; name: string; role: Role; joinedAt: string };
export type Invite = { id: string; email: string; role: Role; createdAt: string; expiresAt: string; acceptUrl?: string };

export type FreshchatConnection = {
  apiBaseUrl: string;
  apiKeyMasked: string;
  appId: string | null;
  replyAgentId: string | null;
  replyAgentName: string | null;
  webhookUrl: string;
  webhookPublicKeySet: boolean;
  verifiedAt: string | null;
  lastError: string | null;
};

export type FreshchatAgentOption = { id: string; name: string; email?: string; available?: boolean };

export type AgentSettings = {
  mode: AgentMode;
  persona: string;
  confidenceThreshold: number;
  handoffKeywords: string;
  handoffMessage: string;
  debounceSeconds: number;
};

export type KnowledgeVersion = {
  id: string;
  number: number;
  title: string;
  status: "draft" | "active" | "archived";
  chunkCount: number;
  docCount: number;
  createdAt: string;
  activatedAt: string | null;
};

export type KnowledgeDoc = { id: string; title: string; sourceType: string; charCount: number; createdAt: string };

export type GoldenTest = {
  id: string;
  question: string;
  expected: string;
  lastResult: "pass" | "fail" | null;
  lastNote: string | null;
  lastAnswer: string | null;
  lastRunAt: string | null;
};

export type Citation = { chunkId: string; heading: string; excerpt: string; score: number };

export type Draft = {
  answer: string;
  confidence: number;
  citations: Citation[];
  needsHuman: boolean;
  reason: string;
  model: string;
  latencyMs: number;
};

export type ConversationRow = {
  id: string;
  state: ConversationState;
  stateReason: string;
  freshchatStatus: string | null;
  customerName: string | null;
  lastMessagePreview: string;
  lastCustomerMessageAt: string | null;
  turnCount: number;
  needsAttention: boolean;
  updatedAt: string;
};

export type Message = {
  id: string;
  actorType: string;
  actorId: string | null;
  messageType: string;
  text: string;
  createdTime: string;
  turnId: string | null;
};

export type Turn = {
  id: string;
  customerMessageId: string;
  question: string;
  answer: string;
  confidence: number;
  citations: Citation[];
  decision: TurnDecision;
  reason: string;
  model: string;
  latencyMs: number;
  createdAt: string;
};

export type EventRow = {
  id: string;
  conversationId: string | null;
  type: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type ConversationDetail = { conversation: ConversationRow; messages: Message[]; turns: Turn[]; events: EventRow[] };

/** What the Freshchat sidebar shows for the open conversation. */
export type SidebarState = {
  companyName: string;
  mode: AgentMode;
  state: ConversationState | "unknown";
  stateReason: string;
  lastTurn: Turn | null;
  needsAttention: boolean;
  dashboardUrl: string;
};
