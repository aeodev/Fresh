import { useEffect, useState, type FormEvent } from "react";
import type { Draft, KnowledgeVersion } from "../../shared/types";
import { api } from "../api";
import { useCompany } from "./Company";

type Line = { role: "customer" | "agent"; text: string; result?: Result };
type Result = { draft: Draft | null; gate: { decision: string; reason: string }; retrieved: Array<{ id: string; heading: string; score: number }> };

export function TestChat() {
  const { company } = useCompany();
  const [versions, setVersions] = useState<KnowledgeVersion[]>([]);
  const [versionId, setVersionId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ versions: KnowledgeVersion[] }>(`/api/companies/${company.slug}/knowledge`).then((r) => setVersions(r.versions.filter((v) => v.status !== "archived"))).catch(() => setVersions([]));
  }, [company.slug]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const next: Line[] = [...lines, { role: "customer", text }];
    setLines(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const result = await api<Result>(`/api/companies/${company.slug}/agent/test-chat`, { body: { messages: next.map((l) => ({ role: l.role, text: l.text })), versionId: versionId || undefined } });
      const reply = result.gate.decision === "sent" ? result.draft!.answer : `(${result.gate.decision}: ${result.gate.reason})`;
      setLines([...next, { role: "agent", text: reply, result }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed.");
      setLines(lines);
    } finally {
      setBusy(false);
    }
  };

  const last = [...lines].reverse().find((l) => l.result)?.result;

  return (
    <div className="grid-2">
      <div className="card">
        <div className="card-header">
          <div><h2>Test chat</h2><p className="muted small">Same retrieval and drafting as a live turn. Nothing is sent to Freshchat.</p></div>
          <select value={versionId} onChange={(e) => setVersionId(e.target.value)} style={{ width: "auto" }}>
            <option value="">Active version</option>
            {versions.map((v) => <option key={v.id} value={v.id}>v{v.number} {v.status}{v.title ? ` · ${v.title}` : ""}</option>)}
          </select>
        </div>
        {error && <div className="alert error">{error}</div>}
        <div className="transcript" style={{ minHeight: 200, marginBottom: "0.75rem" }}>
          {lines.length === 0 && <p className="empty">Ask something a customer would ask.</p>}
          {lines.map((l, i) => <div key={i} className={`bubble ${l.role}`}>{l.text}</div>)}
          {busy && <div className="bubble agent muted">Thinking…</div>}
        </div>
        <form onSubmit={send} className="row">
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type as the customer…" style={{ flex: 1 }} />
          <button className="primary" disabled={busy || !input.trim()}>Send</button>
          <button type="button" onClick={() => setLines([])} disabled={busy || !lines.length}>Reset</button>
        </form>
      </div>
      <div className="card">
        <h2>Why</h2>
        {!last ? <p className="empty">Send a message to see the confidence, the gate decision, and the excerpts used.</p> : (
          <>
            <p><span className={`pill ${last.gate.decision}`}>{last.gate.decision}</span> {last.gate.reason}</p>
            {last.draft && (
              <>
                <p><strong>Confidence</strong> {Math.round(last.draft.confidence * 100)}% · <strong>Model</strong> {last.draft.model} · {last.draft.latencyMs} ms</p>
                <p className="muted small">{last.draft.reason}</p>
                <h3>Cited</h3>
                {last.draft.citations.length === 0 ? <p className="muted small">No excerpt was cited.</p> : last.draft.citations.map((c) => <p key={c.chunkId} className="small"><strong>{c.heading}</strong> ({c.score}) — {c.excerpt}</p>)}
              </>
            )}
            <h3>Retrieved</h3>
            {last.retrieved.length === 0 ? <p className="muted small">Nothing matched. Add knowledge that covers this question.</p> : (
              <ul className="small">{last.retrieved.map((r) => <li key={r.id}>{r.heading} <span className="muted">({r.score})</span></li>)}</ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
