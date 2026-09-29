import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { Draft, KnowledgeVersion } from "../../shared/types";
import { api } from "../api";
import { Alert, Avatar, Chip, EmptyState, Icon, Meter, PageHead } from "../components/ui";
import { useCompany } from "./Company";

type Result = { draft: Draft | null; gate: { decision: string; reason: string }; retrieved: Array<{ id: string; heading: string; score: number }> };
type Line = { role: "customer" | "agent"; text: string; result?: Result };

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
      const reply = result.gate.decision === "sent" ? result.draft!.answer : result.gate.decision === "handoff" ? "I'd hand this to a person." : `(${result.gate.decision})`;
      setLines([...next, { role: "agent", text: reply, result }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed.");
      setLines(lines);
    } finally {
      setBusy(false);
    }
  };

  const noKnowledge = versions.length === 0;

  return (
    <>
      <PageHead
        title={<>Talk to your <em>agent</em>.</>}
        subtitle="The same retrieval, drafting and gate as a live turn. Nothing is sent to Freshchat. Every answer shows why."
        actions={
          <>
            <select value={versionId} onChange={(e) => setVersionId(e.target.value)} style={{ width: "auto", minWidth: 200 }}>
              <option value="">Active knowledge</option>
              {versions.map((v) => <option key={v.id} value={v.id}>v{v.number} {v.status}{v.title ? ` · ${v.title}` : ""}</option>)}
            </select>
            <button className="ghost" onClick={() => setLines([])} disabled={busy || !lines.length}><Icon name="refresh" /> Start over</button>
          </>
        }
      />
      {noKnowledge && <Alert tone="warn">No knowledge yet. <Link className="link" to={`/c/${company.slug}/knowledge`}>Add documents</Link> first, then come back.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      <div className="cols" style={{ gridTemplateColumns: "minmax(0, 1fr) 340px" }}>
        <div className="panel" style={{ display: "flex", flexDirection: "column", minHeight: 560, padding: "1.5rem" }}>
          <div className="chat flip grow" style={{ overflowY: "auto", padding: "0.5rem 0.5rem 1rem" }}>
            {lines.length === 0 && <EmptyState icon="sparkles" title="Ask like a customer would">Try one of the suggestions on the right, or type your own.</EmptyState>}
            {lines.map((l, i) => (
              <div key={i} style={{ display: "contents" }}>
                <div className={`msg ${l.role}`}>
                  {l.role === "customer" ? <Avatar name="You" /> : <Avatar name="Agent" kind="bot" />}
                  <div className="bubble">{l.text}</div>
                </div>
                {l.result && (
                  <div className="why">
                    <div className="row between"><Chip tone={l.result.gate.decision}>{l.result.gate.decision}</Chip><span className="mute-2 tiny">{l.result.draft ? `${l.result.draft.model} · ${l.result.draft.latencyMs} ms` : ""}</span></div>
                    {l.result.draft && <div style={{ margin: "0.5rem 0" }}><Meter value={l.result.draft.confidence} /></div>}
                    <div>{l.result.gate.reason}{l.result.draft?.reason ? ` ${l.result.draft.reason}` : ""}</div>
                    {l.result.draft && l.result.draft.citations.length > 0 && (
                      <details style={{ marginTop: 6 }}>
                        <summary className="link small">{l.result.draft.citations.length} source{l.result.draft.citations.length === 1 ? "" : "s"}</summary>
                        {l.result.draft.citations.map((c) => <div key={c.chunkId} className="small" style={{ marginTop: 6 }}><strong>{c.heading}</strong> — {c.excerpt}</div>)}
                      </details>
                    )}
                    {l.result.retrieved.length === 0 && <div className="mute small" style={{ marginTop: 4 }}>Nothing in the knowledge matched this question.</div>}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="msg agent"><Avatar name="Agent" kind="bot" /><div className="bubble typing"><i /><i /><i /></div></div>}
            <div ref={endRef} />
          </div>
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); void ask(input); }} className="composer">
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type as the customer…" disabled={busy || noKnowledge} autoFocus />
            <button className="primary" disabled={busy || !input.trim() || noKnowledge}><Icon name="send" /> Send</button>
          </form>
        </div>
        <aside className="stack" style={{ gap: "1.25rem" }}>
          <div className="panel soft">
            <div className="label" style={{ marginBottom: "0.75rem" }}>Try asking</div>
            <div className="stack" style={{ gap: "0.5rem" }}>
              {SUGGESTIONS.map((s) => <button key={s} type="button" className="sm" style={{ justifyContent: "flex-start", background: "#fff" }} onClick={() => void ask(s)} disabled={busy || noKnowledge}>{s}</button>)}
            </div>
          </div>
          <div className="panel soft">
            <div className="label" style={{ marginBottom: "0.75rem" }}>How it decides</div>
            <ol className="small" style={{ margin: 0, paddingLeft: "1.1rem", lineHeight: 1.7, color: "var(--ink-2)" }}>
              <li>Finds the six most relevant excerpts in the active knowledge.</li>
              <li>Drafts a reply that must cite those excerpts.</li>
              <li>Sends only if it is confident and grounded; otherwise hands to a person.</li>
            </ol>
          </div>
        </aside>
      </div>
    </>
  );
}
