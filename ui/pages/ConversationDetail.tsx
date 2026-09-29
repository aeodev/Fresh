import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { ConversationDetail as Detail, Turn } from "../../shared/types";
import { api, formatDate, timeAgo } from "../api";
import { Alert, Avatar, Chip, EmptyState, Icon, PageHeader, Skeleton, useToast } from "../components/ui";
import { useCompany } from "./Company";
import { StateChip } from "./Conversations";
import { eventIcon } from "./Activity";

function TurnCard({ turn }: { turn: Turn }) {
  const pct = Math.round(turn.confidence * 100);
  return (
    <div className="turn-card">
      <div className="row between"><Chip tone={turn.decision}>{turn.decision}</Chip><span className="muted tiny">{turn.model || "no model"} · {turn.latencyMs} ms</span></div>
      {turn.decision !== "error" && <div className="bar"><i style={{ width: `${pct}%` }} /></div>}
      <div><strong>{pct}% confident</strong> · {turn.citations.length} source{turn.citations.length === 1 ? "" : "s"} · {turn.reason}</div>
      {turn.decision !== "sent" && turn.answer && <div style={{ marginTop: 4 }}><em className="muted">Draft:</em> {turn.answer}</div>}
      {turn.citations.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary className="small">Sources</summary>
          {turn.citations.map((c) => <div key={c.chunkId} className="small" style={{ marginTop: 4 }}><strong>{c.heading}</strong> — {c.excerpt}</div>)}
        </details>
      )}
    </div>
  );
}

export function ConversationDetail() {
  const { company, allowed } = useCompany();
  const { id = "" } = useParams();
  const toast = useToast();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/companies/${company.slug}/conversations/${encodeURIComponent(id)}`;

  const load = useCallback(() => api<Detail>(base).then(setDetail).catch((e) => setError(e.message)), [base]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [load]);

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

  if (error && !detail) return <Alert tone="error">{error}</Alert>;
  if (!detail) return <div className="card"><Skeleton lines={5} /></div>;
  const { conversation, messages, turns, events } = detail;
  const turnById = new Map(turns.map((t) => [t.id, t]));
  const pendingByCustomerMessage = new Map(turns.filter((t) => t.decision !== "sent").map((t) => [t.customerMessageId, t]));
  const canAct = allowed("conversations.takeover");
  const customer = conversation.customerName || "Customer";

  return (
    <>
      <p className="small"><Link to={`/c/${company.slug}/conversations`}><Icon name="arrowLeft" size={13} /> Conversations</Link></p>
      <PageHeader
        title={<span className="row" style={{ gap: "0.7rem" }}><Avatar name={customer} size="lg" /> {customer}</span>}
        subtitle={<span className="row"><StateChip state={conversation.state} /><span>{conversation.stateReason}</span><span className="mono subtle tiny">{conversation.id}</span></span>}
        actions={canAct ? (
          <>
            {conversation.state === "agent" && <button className="danger" disabled={busy} onClick={() => void act("/state", { state: "human" }, "You own this chat now.")}><Icon name="hand" /> Take over</button>}
            {conversation.state === "human" && <button className="primary" disabled={busy} onClick={() => void act("/state", { state: "agent" }, "Handed back to the agent.")}><Icon name="sparkles" /> Hand back to agent</button>}
            {conversation.state !== "resolved" && <button disabled={busy} onClick={() => void act("/run", {}, "Agent ran.")}><Icon name="bolt" /> Reply now</button>}
          </>
        ) : undefined}
      />
      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(280px, 1fr)" }}>
        <div className="card">
          <div className="chat">
            {messages.length === 0 && <EmptyState icon="chat" title="No messages stored yet" />}
            {messages.map((m) => {
              const kind = m.messageType === "private" ? "private" : m.actorType === "user" ? "customer" : m.actorType === "system" ? "system" : "agent";
              const turn = m.turnId ? turnById.get(m.turnId) : null;
              const ours = kind === "agent" && Boolean(turn);
              const pending = m.actorType === "user" ? pendingByCustomerMessage.get(m.id) : null;
              return (
                <div key={m.id} style={{ display: "contents" }}>
                  <div className={`msg ${kind} ${kind === "agent" && !ours ? "human" : ""}`}>
                    {kind === "customer" && <Avatar name={customer} />}
                    {kind === "agent" && (ours ? <Avatar name="Agent" kind="bot" /> : <Avatar name={m.actorId ?? "Agent"} kind="human" />)}
                    <div className="bubble">
                      {m.text || <em style={{ opacity: 0.7 }}>(non-text message)</em>}
                      <span className="meta">{kind === "customer" ? customer : kind === "agent" ? (ours ? "FreshQA agent" : "Teammate") : kind === "private" ? "Private note" : "System"} · {formatDate(m.createdTime)}</span>
                    </div>
                  </div>
                  {turn && <TurnCard turn={turn} />}
                  {pending && <TurnCard turn={pending} />}
                </div>
              );
            })}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div><h2>Timeline</h2><p>Every decision, newest first.</p></div></div>
          <ul className="timeline">
            {events.map((e) => {
              const { icon, tone } = eventIcon(e.type);
              return (
                <li key={e.id}>
                  <span className={`ico ${tone}`}><Icon name={icon} /></span>
                  <div><div className="what">{e.type.replace(/_/g, " ")}</div><div className="detail">{summarize(e.detail)}</div></div>
                  <span className="muted tiny" style={{ whiteSpace: "nowrap" }}>{timeAgo(e.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
}

export function summarize(detail: Record<string, unknown>) {
  return Object.entries(detail)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ")
    .slice(0, 220);
}
