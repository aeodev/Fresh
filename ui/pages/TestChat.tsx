import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { Draft, KnowledgeVersion } from "../../shared/types";
import { api } from "../api";
import { Alert, Avatar, Chip, EmptyState, Icon, Meter, PageHeader } from "../components/ui";
import { useCompany } from "./Company";

type Line = { role: "customer" | "agent"; text: string; result?: Result };
type Result = { draft: Draft | null; gate: { decision: string; reason: string }; retrieved: Array<{ id: string; heading: string; score: number }> };

const SUGGESTIONS = ["What are your opening hours?", "How long does delivery take?", "Can I get a refund?", "I want to talk to a human"];

export function TestChat() {
  const { company } = useCompany();
  const [versions, setVersions] = useState<KnowledgeVersion[]>([]);
  const [versionId, setVersionId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ versions: KnowledgeVersion[] }>(`/api/companies/${company.slug}/knowledge`).then((r) => setVersions(r.versions.filter((v) => v.status !== "archived"))).catch(() => setVersions([]));
  }, [company.slug]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [lines, busy]);

  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    const next: Line[] = [...lines, { role: "customer", text: text.trim() }];
    setLines(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const result = await api<Result>(`/api/companies/${company.slug}/agent/test-chat`, { body: { messages: next.map((l) => ({ role: l.role, text: l.text })), versionId: versionId || undefined } });
      const reply = result.gate.decision === "sent" ? result.draft!.answer : result.gate.decision === "handoff" ? "🙋 Hands off to a person" : `(${result.gate.decision})`;
      setLines([...next, { role: "agent", text: reply, result }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed.");
      setLines(lines);
    } finally {
      setBusy(false);
    }
  };
  const send = (e: FormEvent) => {
    e.preventDefault();
    void ask(input);
  };

  const last = [...lines].reverse().find((l) => l.result)?.result;
  const noKnowledge = versions.length === 0;

  return (
    <>
      <PageHeader
        eyebrow="Test chat"
        title="Talk to your agent"
        subtitle="Exactly what a live turn does: retrieve, draft, gate. Nothing is sent to Freshchat."
        actions={
          <>
            <select value={versionId} onChange={(e) => setVersionId(e.target.value)} style={{ width: "auto" }}>
              <option value="">Active knowledge</option>
              {versions.map((v) => <option key={v.id} value={v.id}>v{v.number} {v.status}{v.title ? ` · ${v.title}` : ""}</option>)}
            </select>
            <button className="ghost" onClick={() => setLines([])} disabled={busy || !lines.length}><Icon name="refresh" /> Reset</button>
          </>
        }
      />
      {noKnowledge && <Alert tone="warn">There is no knowledge yet. <Link to={`/c/${company.slug}/knowledge`}>Add documents</Link> first, then come back.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1.5fr) minmax(300px, 1fr)" }}>
        <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 480 }}>
          <div className="chat grow" style={{ overflowY: "auto", paddingBottom: "0.5rem" }}>
            {lines.length === 0 && (
              <EmptyState icon="sparkles" title="Ask something a customer would ask" action={
                <div className="row" style={{ justifyContent: "center" }}>
                  {SUGGESTIONS.map((s) => <button key={s} type="button" className="small" onClick={() => void ask(s)} disabled={busy || noKnowledge}>{s}</button>)}
                </div>
              } />
            )}
            {lines.map((l, i) => (
              <div key={i} className={`msg ${l.role}`}>
                {l.role === "customer" ? <Avatar name="You" /> : <Avatar name="Agent" kind="bot" />}
                <div className="bubble">{l.text}</div>
              </div>
            ))}
            {busy && <div className="msg agent"><Avatar name="Agent" kind="bot" /><div className="bubble typing"><i /><i /><i /></div></div>}
            <div ref={endRef} />
          </div>
          <form onSubmit={send} className="composer" style={{ marginTop: "0.75rem" }}>
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type as the customer…" disabled={busy || noKnowledge} autoFocus />
            <button className="primary" disabled={busy || !input.trim() || noKnowledge}><Icon name="send" /> Send</button>
          </form>
        </div>
        <div className="card">
          <div className="card-header"><div><h2>Why</h2><p>How the last answer was decided.</p></div></div>
          {!last ? <EmptyState icon="target" title="No answer yet">Send a message to see confidence, the gate decision, and the excerpts used.</EmptyState> : (
            <div className="stack" style={{ gap: "0.9rem" }}>
              <div className="row"><Chip tone={last.gate.decision} dot>{last.gate.decision}</Chip><span className="small">{last.gate.reason}</span></div>
              {last.draft && (
                <>
                  <div><label>Confidence</label><Meter value={last.draft.confidence} /></div>
                  <div className="muted small">{last.draft.reason} · {last.draft.model} · {last.draft.latencyMs} ms</div>
                  <div>
                    <label>Cited excerpts</label>
                    {last.draft.citations.length === 0 ? <p className="muted small">No excerpt was cited.</p> : last.draft.citations.map((c) => (
                      <div key={c.chunkId} className="doc" style={{ marginBottom: 6, alignItems: "flex-start" }}><span className="ico tone-brand"><Icon name="file" /></span><div className="small"><strong>{c.heading}</strong><div className="muted">{c.excerpt}</div></div></div>
                    ))}
                  </div>
                </>
              )}
              <div>
                <label>Retrieved</label>
                {last.retrieved.length === 0 ? <p className="muted small">Nothing matched. Add knowledge that covers this question.</p> : (
                  <ul className="small" style={{ margin: 0, paddingLeft: "1.1rem" }}>{last.retrieved.map((r) => <li key={r.id}>{r.heading} <span className="muted">({r.score})</span></li>)}</ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
