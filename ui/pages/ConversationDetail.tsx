import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { ConversationDetail as Detail, Turn } from "../../shared/types";
import { api, formatDate, timeAgo } from "../api";
import { useCompany } from "./Company";
import { StatePill } from "./Conversations";

function TurnCard({ turn }: { turn: Turn }) {
  return (
    <div className="turn-note">
      <span className={`pill ${turn.decision}`}>{turn.decision}</span> {Math.round(turn.confidence * 100)}% · {turn.citations.length} source{turn.citations.length === 1 ? "" : "s"} · {turn.reason}
      {turn.decision !== "sent" && turn.answer && <div style={{ marginTop: 4 }}><em>Draft:</em> {turn.answer}</div>}
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

  const act = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api(`${base}${path}`, { body });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  if (error && !detail) return <div className="alert error">{error}</div>;
  if (!detail) return <p className="muted">Loading…</p>;
  const { conversation, messages, turns, events } = detail;
  const turnById = new Map(turns.map((t) => [t.id, t]));
  const turnByCustomerMessage = new Map(turns.filter((t) => t.decision !== "sent").map((t) => [t.customerMessageId, t]));
  const canAct = allowed("conversations.takeover");

  return (
    <>
      <p className="small"><Link to={`/c/${company.slug}/conversations`}>← Conversations</Link></p>
      <div className="card">
        <div className="card-header">
          <div>
            <h2>{conversation.customerName || "Customer"} <span className="muted mono small">{conversation.id}</span></h2>
            <div className="row"><StatePill state={conversation.state} /><span className="muted small">{conversation.stateReason}</span></div>
          </div>
          {canAct && (
            <div className="row">
              {conversation.state === "agent" && <button className="danger" disabled={busy} onClick={() => void act("/state", { state: "human" })}>Take over</button>}
              {conversation.state === "human" && <button className="primary" disabled={busy} onClick={() => void act("/state", { state: "agent" })}>Hand back to agent</button>}
              {conversation.state !== "resolved" && <button disabled={busy} onClick={() => void act("/run", {})}>Ask agent to reply now</button>}
            </div>
          )}
        </div>
        {error && <div className="alert error">{error}</div>}
        <div className="transcript">
          {messages.length === 0 && <p className="empty">No messages stored yet.</p>}
          {messages.map((m) => {
            const kind = m.messageType === "private" ? "private" : m.actorType === "user" ? "customer" : m.actorType === "system" ? "system" : "agent";
            const turn = m.turnId ? turnById.get(m.turnId) : null;
            const pending = m.actorType === "user" ? turnByCustomerMessage.get(m.id) : null;
            return (
              <div key={m.id} style={{ display: "contents" }}>
                <div className={`bubble ${kind}`}>
                  {m.text || <em className="muted">(non-text message)</em>}
                  <span className="meta">{kind === "customer" ? "Customer" : kind === "agent" ? (turn ? "FreshQA agent" : "Agent") : kind === "private" ? "Private note" : "System"} · {formatDate(m.createdTime)}</span>
                </div>
                {turn && <TurnCard turn={turn} />}
                {pending && <TurnCard turn={pending} />}
              </div>
            );
          })}
        </div>
      </div>
      <div className="card">
        <h3>Timeline</h3>
        <table>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}><td style={{ whiteSpace: "nowrap" }} className="muted small">{timeAgo(e.createdAt)}</td><td><span className="pill">{e.type}</span></td><td className="small mono muted">{JSON.stringify(e.detail)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
