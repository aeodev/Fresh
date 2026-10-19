import { Select } from "../components/Select";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { ConversationDetail, ConversationRow, Turn } from "../../shared/types";
import { cleanFreshchatText } from "../../shared/freshchat-text";
import { api, formatDate, timeAgo } from "../api";
import { ChatText } from "../components/ChatText";
import { Alert, Avatar, Chip, EmptyState, Icon, Skeleton, useToast } from "../components/ui";
import { eventIcon, summarize } from "./Activity";
import { useCompany } from "./Company";

const VIEWS = [
  { key: "attention", label: "Needs attention" },
  { key: "agent", label: "Agent handling" },
  { key: "human", label: "Teammate handling" },
  { key: "all", label: "All synced" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];
type StatusKey = "open" | "resolved" | "all";
type ViewCounts = Record<ViewKey, number> & { total: number; openAttention: number };

function lastReplyLabel(row: ConversationRow) {
  if (row.lastMessageActorType === "user") return "Customer replied";
  if (row.lastMessageActorType === "agent") return row.lastMessageTurnId ? "Agent replied" : "Teammate replied";
  if (row.lastMessageActorType === "bot") return "Bot replied";
  return "No reply yet";
}

function customerWaiting(row: ConversationRow) {
  return row.lastMessageActorType === "user" && row.lastCustomerMessageAt && row.freshchatStatus?.toLowerCase() !== "resolved"
    ? `Customer waiting · ${timeAgo(row.lastCustomerMessageAt)}` : null;
}

export function StateChip({ state, sidebarEnabled = true }: { state: ConversationRow["state"]; sidebarEnabled?: boolean }) {
  if (state === "agent" && !sidebarEnabled) return <Chip tone="off" dot>Off</Chip>;
  return <Chip tone={state} dot>{state === "agent" ? "Agent" : state === "human" ? "Person" : "Resolved"}</Chip>;
}

export function Conversations() {
  const { company } = useCompany();
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestedView = params.get("view") ?? (params.get("attention") === "1" ? "attention" : params.get("state") ?? (id ? "all" : "attention"));
  const active = VIEWS.find((view) => view.key === requestedView) ?? VIEWS[3];
  const requestedStatus = params.get("status") ?? (requestedView === "resolved" ? "resolved" : id ? "all" : "open");
  const status: StatusKey = requestedStatus === "resolved" || requestedStatus === "all" ? requestedStatus : "open";
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [limit, setLimit] = useState(200);
  const [counts, setCounts] = useState<ViewCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let live = true;
    const load = () => api<{ conversations: ConversationRow[]; counts: ViewCounts }>(`/api/companies/${company.slug}/conversations?view=${active.key}&status=${status}&limit=${limit}`)
      .then((result) => { if (live) { setRows(result.conversations); setCounts(result.counts); setError(null); } })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "Could not load conversations."); });
    void load();
    const timer = setInterval(() => void load(), 8000);
    return () => { live = false; clearInterval(timer); };
  }, [company.slug, active.key, status, limit]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !rows) return rows;
    return rows.filter((c) => (c.customerName ?? "").toLowerCase().includes(needle) || cleanFreshchatText(c.lastMessagePreview).toLowerCase().includes(needle) || c.id.includes(needle));
  }, [rows, q]);

  const open = (cid: string) => navigate(`/c/${company.slug}/conversations/${encodeURIComponent(cid)}${params.toString() ? `?${params}` : ""}`);
  const chooseView = (key: ViewKey) => {
    setRows(null);
    setLimit(200);
    navigate(`/c/${company.slug}/conversations?view=${key}&status=${status}`);
  };
  const chooseStatus = (nextStatus: StatusKey) => {
    setRows(null);
    setLimit(200);
    navigate(`/c/${company.slug}/conversations?view=${active.key}&status=${nextStatus}`);
  };

  return (
    <div className="conversation-page">
      <header className="conversation-header">
        <div className="conversation-title"><h1>Conversations</h1><span className="attention-total">{counts?.openAttention ?? "·"} need attention</span></div>
        <p>See what needs a person, what the agent is handling, and the full chat history.</p>
        <div className="conversation-nav">
          <nav className="conversation-tabs" aria-label="Conversation work views">
            {VIEWS.map((view) => <button key={view.key} type="button" className={active.key === view.key ? "on" : ""} aria-current={active.key === view.key ? "page" : undefined} onClick={() => chooseView(view.key)}>{view.label}<span>{counts?.[view.key] ?? "·"}</span></button>)}
          </nav>
          <label className="conversation-status">Freshchat status <Select label="Freshchat status" value={status} onValueChange={(value) => chooseStatus(value as StatusKey)}><option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All statuses</option></Select></label>
        </div>
      </header>
      {error && <Alert tone="error">{error}</Alert>}
      <div className={`inbox ${id ? "thread-open" : ""}`}>
        <aside className="rail">
          <div className="tools">
            <div className="list-head"><strong>{active.label}</strong><span>{counts?.[active.key] ?? "·"}</span></div>
            <div className="search"><Icon name="search" /><input type="search" placeholder="Search name or message" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <span className="inbox-sync-note">Synced to FreshQA · newest first</span>
          </div>
          <div className="rows">
            {visible === null ? <div style={{ padding: "1rem" }}><Skeleton lines={5} title={false} /></div> : visible.length === 0 ? (
              <div className="inbox-list-empty">
                <div className="inbox-list-empty-icon"><Icon name={rows && rows.length ? "search" : "chat"} size={20} /></div>
                <strong>{q ? "No matching chats" : counts?.total ? "No chats in this view" : "No chats yet"}</strong>
                <span>{q ? "Try another name or message." : counts?.total ? "Try another work view or Freshchat status." : "Customer chats will appear here once Freshchat is connected."}</span>
              </div>
            ) : (
              <>{visible.map((c) => (
                <div key={c.id} className={`convo ${c.id === id ? "on" : ""}`} onClick={() => open(c.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(c.id); } }} role="button" tabIndex={0}>
                  <Avatar name={c.customerName || c.id} />
                  <div className="grow">
                    <div className="name"><span className="truncate">{c.customerName || c.id.slice(0, 8)}</span><StateChip state={c.state} sidebarEnabled={c.sidebarEnabled} /></div>
                    <div className="preview">{cleanFreshchatText(c.lastMessagePreview) || c.stateReason || "No preview"}</div>
                    <div className="convo-signals"><span>{lastReplyLabel(c)}</span>{customerWaiting(c) && <span className="waiting">{customerWaiting(c)}</span>}{c.needsAttention && <span className="attention-reason">{c.stateReason || "Review needed"}</span>}</div>
                  </div>
                  <time>{timeAgo(c.lastMessageAt ?? c.updatedAt)}</time>
                </div>
              ))}
              {rows && counts && limit < 2000 && rows.length < counts[active.key] && <button type="button" className="inbox-more" onClick={() => setLimit((current) => Math.min(2000, current + 200))}>Show more · {rows.length} of {counts[active.key]}</button>}
              </>
            )}
          </div>
        </aside>
        <section className="stage">
          {id && <button type="button" className="mobile-inbox-back ghost" onClick={() => navigate(`/c/${company.slug}/conversations?${params}`)}><Icon name="arrowLeft" /> Back to conversations</button>}
          {id ? <Thread key={id} id={id} /> : rows?.length ? (
            <div className="inbox-start"><Icon name="chat" size={28} /><h2>Choose a conversation</h2><p>See the messages, source-backed answers, and handoff controls.</p></div>
          ) : counts?.total ? (
            <div className="inbox-start"><Icon name="chat" size={28} /><h2>No chats in this view</h2><p>Try another work view or Freshchat status.</p></div>
          ) : (
            <div className="inbox-setup">
              <span className="inbox-setup-icon"><Icon name="chat" size={28} /></span>
              <h2>Chats will land here</h2>
              <p>Connect Freshchat, install the sidebar app, then send a message through your customer widget. This inbox will show the agent's decisions as they happen.</p>
              <div className="inbox-setup-steps"><span>1 · Connect Freshchat</span><span>2 · Install sidebar</span><span>3 · Send a test chat</span></div>
              <Link className="primary inbox-setup-link" to={`/c/${company.slug}/settings#connection`}>Open connection setup <Icon name="arrowRight" size={16} /></Link>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Why({ turn }: { turn: Turn }) {
  if (turn.decision === "silent") return <div className="why"><Chip tone="silent">Stayed quiet</Chip><div style={{ marginTop: 6 }}>{turn.reason}</div></div>;
  const pct = Math.round(turn.confidence * 100);
  return (
    <div className="why">
      <div className="row between"><Chip tone={turn.decision}>{turn.decision}</Chip><span className="mute-2 tiny">{turn.model || "no model"} · {turn.latencyMs} ms</span></div>
      {turn.decision !== "error" && <div className="track"><i style={{ width: `${pct}%` }} /></div>}
      <div><strong className="num">{pct}%</strong> confident · {turn.citations.length} source{turn.citations.length === 1 ? "" : "s"} · {turn.reason}</div>
      {turn.decision !== "sent" && turn.answer && <div style={{ marginTop: 6 }}><span className="mute">Draft:</span> {turn.answer}</div>}
      {turn.citations.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary className="link small">Sources</summary>
          {turn.citations.map((c) => <div key={c.chunkId} className="small" style={{ marginTop: 6 }}><strong>{c.heading}</strong>: {c.excerpt}</div>)}
        </details>
      )}
    </div>
  );
}

function Thread({ id }: { id: string }) {
  const [sourceParams] = useSearchParams();
  const sourceMessage = sourceParams.get("message");
  const { company, allowed } = useCompany();
  const toast = useToast();
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/companies/${company.slug}/conversations/${encodeURIComponent(id)}`;

  const load = useCallback(() => api<ConversationDetail>(base).then(setDetail).catch((e) => setError(e.message)), [base]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [load]);

  const sourceLoaded = Boolean(detail);
  useEffect(() => {
    if (!sourceMessage || !sourceLoaded) return;
    const element = document.getElementById(`source-message-${sourceMessage}`);
    element?.scrollIntoView({ block: "center" });
  }, [sourceMessage, sourceLoaded]);

  const act = async (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      const r = await api<{ outcome?: string }>(`${base}${path}`, { body });
      await load();
      toast.success(r.outcome ? `Agent: ${r.outcome}` : done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  if (error && !detail) return <div style={{ padding: "2rem" }}><Alert tone="error">{error}</Alert></div>;
  if (!detail) return <div style={{ padding: "2rem" }}><Skeleton lines={5} /></div>;
  const { conversation, messages, turns, events } = detail;
  const turnById = new Map(turns.map((t) => [t.id, t]));
  const pending = new Map(turns.filter((t) => t.decision !== "sent").map((t) => [t.customerMessageId, t]));
  const customer = conversation.customerName || "Customer";
  const canAct = allowed("conversations.takeover");

  return (
    <>
      <div className="stage-head">
        <Avatar name={customer} size="lg" />
        <div className="grow">
          <div className="row"><h2 style={{ fontSize: "1.25rem" }}>{customer}</h2><StateChip state={conversation.state} sidebarEnabled={conversation.sidebarEnabled} />{conversation.needsAttention && <Chip tone="warn">needs attention</Chip>}</div>
          <div className="mute small">{conversation.sidebarEnabled ? conversation.stateReason : "Turn on FreshQA in this chat's Freshchat sidebar to test replies."} <span className="mono mute-2 tiny">· {conversation.id}</span></div>
        </div>
        {canAct && (
          <div className="row">
            {conversation.sidebarEnabled && conversation.state === "agent" && <button className="danger" disabled={busy} onClick={() => void act("/state", { state: "human" }, "You own this chat now.")}><Icon name="hand" /> Take over</button>}
            {conversation.sidebarEnabled && conversation.state === "agent" && <button disabled={busy} onClick={() => void act("/run", {}, "Agent ran.")}><Icon name="bolt" /> Reply now</button>}
          </div>
        )}
      </div>
      {sourceMessage && <div className="source-conversation-banner"><Link className="link small" to={`/c/${company.slug}/analysis`}>← Back to analysis</Link><span className="small mute">{messages.some(m=>m.id===sourceMessage) ? "Referenced reply highlighted below" : "The referenced message is no longer available."}</span></div>}
      <div className="thread chat">
        {messages.length === 0 && <EmptyState icon="chat" title="No messages stored yet" />}
        {messages.map((m) => {
          const text = cleanFreshchatText(m.text);
          const kind = m.messageType === "private" ? "private" : m.actorType === "user" ? "customer" : m.actorType === "system" ? "system" : "agent";
          const turn = m.turnId ? turnById.get(m.turnId) : null;
          const ours = kind === "agent" && Boolean(turn);
          const draft = m.actorType === "user" ? pending.get(m.id) : null;
          return (
            <div key={m.id} style={{ display: "contents" }}>
              {text ? <div id={`source-message-${m.id}`} className={`msg ${kind} ${kind === "agent" && !ours ? "human" : ""} ${sourceMessage===m.id ? "analysis-source-message" : ""}`}>
                {kind === "customer" && <Avatar name={customer} />}
                {kind === "agent" && (ours ? <Avatar name="Agent" kind="bot" /> : <Avatar name={m.actorId ?? "Agent"} kind="human" />)}
                <div className="bubble">
                  <ChatText text={text} />
                  <span className="meta">{kind === "customer" ? customer : kind === "agent" ? (ours ? "FreshQA agent" : "Teammate") : kind === "private" ? "Private note" : "System"} · {formatDate(m.createdTime)}</span>
                </div>
              </div> : <div className="thread-event">{kind === "private" ? "Private note" : "Attachment or rich message"} · {formatDate(m.createdTime)}</div>}
              {turn && <Why turn={turn} />}
              {draft && <Why turn={draft} />}
            </div>
          );
        })}
      </div>
      <div className="foot">
        <details>
          <summary className="link small">Timeline · {events.length} events</summary>
          <ul className="timeline" style={{ marginTop: "0.5rem" }}>
            {events.map((e) => {
              const { icon, tone } = eventIcon(e.type);
              return (
                <li key={e.id} className="ev">
                  <span className={`ico ${tone}`}><Icon name={icon} /></span>
                  <div><div className="what">{e.type.replace(/_/g, " ")}</div><div className="detail">{summarize(e.detail)}</div></div>
                  <span className="mute-2 tiny" style={{ whiteSpace: "nowrap" }}>{timeAgo(e.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        </details>
      </div>
    </>
  );
}
