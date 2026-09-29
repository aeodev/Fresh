import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { ConversationDetail, ConversationRow, Turn } from "../../shared/types";
import { api, formatDate, timeAgo } from "../api";
import { Alert, Avatar, Chip, EmptyState, Icon, PageHead, Skeleton, useToast } from "../components/ui";
import { eventIcon, summarize } from "./Activity";
import { useCompany } from "./Company";

const FILTERS: Array<{ key: string; label: string; query: string }> = [
  { key: "all", label: "All", query: "" },
  { key: "agent", label: "With the agent", query: "state=agent" },
  { key: "human", label: "With people", query: "state=human" },
  { key: "attention", label: "Attention", query: "attention=1" },
  { key: "resolved", label: "Resolved", query: "state=resolved" },
];

export function StateChip({ state }: { state: ConversationRow["state"] }) {
  return <Chip tone={state} dot>{state === "agent" ? "Agent" : state === "human" ? "Person" : "Resolved"}</Chip>;
}

export function Conversations() {
  const { company } = useCompany();
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const active = FILTERS.find((f) => (f.key === "attention" ? params.get("attention") === "1" : f.query === (params.get("state") ? `state=${params.get("state")}` : ""))) ?? FILTERS[0];
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    api<{ conversations: ConversationRow[] }>(`/api/companies/${company.slug}/conversations?${active.query}&limit=100`).then((r) => setRows(r.conversations)).catch((e) => setError(e.message));
  }, [company.slug, active.query, id]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !rows) return rows;
    return rows.filter((c) => (c.customerName ?? "").toLowerCase().includes(needle) || c.lastMessagePreview.toLowerCase().includes(needle) || c.id.includes(needle));
  }, [rows, q]);

  const open = (cid: string) => navigate(`/c/${company.slug}/conversations/${encodeURIComponent(cid)}${params.toString() ? `?${params}` : ""}`);

  return (
    <>
      <PageHead title={<>Every <em>conversation</em>.</>} subtitle="Who is talking to whom, and every decision the agent made along the way." />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="inbox">
        <aside className="rail">
          <div className="tools">
            <div className="search"><Icon name="search" /><input type="search" placeholder="Search name or message" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="pills">
              {FILTERS.map((f) => <button key={f.key} type="button" className={f.key === active.key ? "on" : ""} onClick={() => setParams(f.query ? new URLSearchParams(f.query) : new URLSearchParams())}>{f.label}</button>)}
            </div>
          </div>
          <div className="rows">
            {visible === null ? <div style={{ padding: "1rem" }}><Skeleton lines={5} title={false} /></div> : visible.length === 0 ? (
              <EmptyState icon="chat" title={rows && rows.length ? "No matches" : "Nothing yet"}>{rows && rows.length ? "Try a different search." : "Conversations appear the moment Freshchat sends the first event."}</EmptyState>
            ) : (
              visible.map((c) => (
                <div key={c.id} className={`convo ${c.id === id ? "on" : ""}`} onClick={() => open(c.id)} role="button" tabIndex={0}>
                  <Avatar name={c.customerName || c.id} />
                  <div className="grow">
                    <div className="name"><span className="truncate">{c.customerName || c.id.slice(0, 8)}</span><StateChip state={c.state} /></div>
                    <div className="preview">{c.lastMessagePreview || c.stateReason || "—"}</div>
                  </div>
                  <time>{timeAgo(c.updatedAt)}</time>
                </div>
              ))
            )}
          </div>
        </aside>
        <section className="stage">
          {id ? <Thread key={id} id={id} /> : <EmptyState icon="chat" title="Pick a conversation">The transcript, the agent's reasoning, and the take-over controls show up here.</EmptyState>}
        </section>
      </div>
    </>
  );
}

function Why({ turn }: { turn: Turn }) {
  const pct = Math.round(turn.confidence * 100);
  return (
    <div className="why">
      <div className="row between"><Chip tone={turn.decision}>{turn.decision}</Chip><span className="mute-2 tiny">{turn.model || "no model"} · {turn.latencyMs} ms</span></div>
      {turn.decision !== "error" && <div className="bar"><i style={{ width: `${pct}%` }} /></div>}
      <div><strong className="num">{pct}%</strong> confident · {turn.citations.length} source{turn.citations.length === 1 ? "" : "s"} · {turn.reason}</div>
      {turn.decision !== "sent" && turn.answer && <div style={{ marginTop: 6 }}><span className="mute">Draft:</span> {turn.answer}</div>}
      {turn.citations.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary className="link small">Sources</summary>
          {turn.citations.map((c) => <div key={c.chunkId} className="small" style={{ marginTop: 6 }}><strong>{c.heading}</strong> — {c.excerpt}</div>)}
        </details>
      )}
    </div>
  );
}

function Thread({ id }: { id: string }) {
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
          <div className="row"><h2 style={{ fontSize: "1.25rem" }}>{customer}</h2><StateChip state={conversation.state} />{conversation.needsAttention && <Chip tone="warn">needs attention</Chip>}</div>
          <div className="mute small">{conversation.stateReason} <span className="mono mute-2 tiny">· {conversation.id}</span></div>
        </div>
        {canAct && (
          <div className="row">
            {conversation.state === "agent" && <button className="danger" disabled={busy} onClick={() => void act("/state", { state: "human" }, "You own this chat now.")}><Icon name="hand" /> Take over</button>}
            {conversation.state === "human" && <button className="green" disabled={busy} onClick={() => void act("/state", { state: "agent" }, "Handed back to the agent.")}><Icon name="sparkles" /> Hand back</button>}
            {conversation.state !== "resolved" && <button disabled={busy} onClick={() => void act("/run", {}, "Agent ran.")}><Icon name="bolt" /> Reply now</button>}
          </div>
        )}
      </div>
      <div className="thread chat">
        {messages.length === 0 && <EmptyState icon="chat" title="No messages stored yet" />}
        {messages.map((m) => {
          const kind = m.messageType === "private" ? "private" : m.actorType === "user" ? "customer" : m.actorType === "system" ? "system" : "agent";
          const turn = m.turnId ? turnById.get(m.turnId) : null;
          const ours = kind === "agent" && Boolean(turn);
          const draft = m.actorType === "user" ? pending.get(m.id) : null;
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
