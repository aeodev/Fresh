import { Select } from "../components/Select";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { Draft, KnowledgeVersion } from "../../shared/types";
import { nextReplyDelayMs, splitReply } from "../../shared/reply-sequence";
import { humanDelayMs } from "../../worker/agent/pace";
import { api } from "../api";
import { ChatText } from "../components/ChatText";
import { ReplyCorrection } from "../components/ReplyCorrection";
import { Alert, Avatar, Chip, EmptyState, Icon, Meter, PageHead } from "../components/ui";
import { useCompany } from "./Company";

type Result = { draft: Draft | null; gate: { decision: string; reason: string }; typingPace: "natural" | "instant"; version: { id: string; number: number; status: string }; retrieved: Array<{ id: string; heading: string; score: number }> };
type Line = { role: "customer" | "agent"; text: string; result?: Result; question?: string };

const SUGGESTIONS = ["What are your opening hours?", "How long does delivery take?", "Can I get a refund?", "I want to talk to a human"];

export function TestChat() {
  const { company, reload } = useCompany();
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

  const ask = async (text: string, publishedVersionId?: string) => {
    if (!text.trim() || busy) return;
    const next: Line[] = [...(publishedVersionId ? [] : lines), { role: "customer", text: text.trim() }];
    setLines(next);
    setInput("");
    setBusy(true);
    setError(null);
    const started = performance.now();
    try {
      const result = await api<Result>(`/api/companies/${company.slug}/agent/test-chat`, { body: { messages: next.map((l) => ({ role: l.role, text: l.text })), versionId: publishedVersionId || versionId || undefined } });
      if (result.gate.decision === "silent") {
        setLines([...next, { role: "agent", text: "", result }]);
        return;
      }
      const reply = result.gate.decision === "sent" ? result.draft!.answer : result.gate.decision === "handoff" ? "I'd hand this to a person." : result.gate.decision === "review" ? "Draft held for review. The agent stays on for your next message." : `(${result.gate.decision})`;
      const parts = result.gate.decision === "sent" ? splitReply(reply) : [reply];
      const shown = [...next];
      for (const [index, part] of parts.entries()) {
        if (result.typingPace !== "instant") {
          const delay = index === 0
            ? humanDelayMs({ questionChars: text.trim().length, answerChars: part.length, alreadySpentMs: performance.now() - started })
            : nextReplyDelayMs(part);
          if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
        }
        shown.push({ role: "agent", text: part, result: index === parts.length - 1 ? result : undefined, question: text.trim() });
        setLines([...shown]);
      }
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
            <Select label="Knowledge version" value={versionId} onValueChange={(value) => setVersionId(value)} style={{ width: "auto", minWidth: 200 }}>
              <option value="">Active knowledge</option>
              {versions.map((v) => <option key={v.id} value={v.id}>v{v.number} {v.status}{v.title ? ` · ${v.title}` : ""}</option>)}
            </Select>
            <button className="ghost" onClick={() => setLines([])} disabled={busy || !lines.length}><Icon name="refresh" /> Start over</button>
          </>
        }
      />
      {noKnowledge && <Alert tone="warn">No knowledge yet. <Link className="link" to={`/c/${company.slug}/knowledge`}>Add documents</Link> first, then come back.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      <div className="cols test-chat-layout">
        <div className="panel test-chat-panel">
          <div className="chat flip grow" style={{ overflowY: "auto", padding: "0.5rem 0.5rem 1rem" }}>
            {lines.length === 0 && <EmptyState icon="sparkles" title="Ask like a customer would">Try one of the suggestions on the right, or type your own.</EmptyState>}
            {lines.map((l, i) => (
              <div key={i} style={{ display: "contents" }}>
                {l.text && <div className={`msg ${l.role}`}>
                  {l.role === "customer" ? <Avatar name="You" /> : <Avatar name="Agent" kind="bot" />}
                  <div className="bubble"><ChatText text={l.text} /></div>
                </div>}
                {l.result && (
                  <div className="why">
                    <div className="row between"><Chip tone={l.result.gate.decision}>{l.result.gate.decision}</Chip><span className="mute-2 tiny">v{l.result.version.number} {l.result.version.status}{l.result.draft ? ` · ${l.result.draft.model} · ${l.result.draft.latencyMs} ms` : ""}</span></div>
                    {l.result.draft && <div style={{ margin: "0.5rem 0" }}><Meter value={l.result.draft.confidence} /></div>}
                    <div>{l.result.gate.reason}{l.result.draft?.reason && l.result.draft.reason !== l.result.gate.reason ? ` ${l.result.draft.reason}` : ""}</div>
                    {l.result.draft && l.result.draft.citations.length > 0 && (
                      <details style={{ marginTop: 6 }}>
                        <summary className="link small">{l.result.draft.citations.length} source{l.result.draft.citations.length === 1 ? "" : "s"}</summary>
                        {l.result.draft.citations.map((c) => <div key={c.chunkId} className="small" style={{ marginTop: 6 }}><strong>{c.heading}</strong>: {c.excerpt}</div>)}
                      </details>
                    )}
                    {l.result.retrieved.length === 0 && l.result.draft?.model !== "greeting" && <div className="mute small" style={{ marginTop: 4 }}>Nothing in the knowledge matched this question.</div>}
                    {l.question && <ReplyCorrection question={l.question} result={l.result} onPublished={(published) => {
                      setVersionId(published.id);
                      setVersions(previous => [...previous.filter(v => v.status !== "active" && v.id !== published.id), published]);
                      void reload();
                      void api<{ versions: KnowledgeVersion[] }>(`/api/companies/${company.slug}/knowledge`).then(r => setVersions(r.versions.filter(v => v.status !== "archived")));
                    }} onRetry={(published) => { if (!busy) void ask(l.question!, published.id); }} />}
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
              <li>Finds relevant excerpts and nearby context in the active knowledge.</li>
              <li>Drafts a sourced answer and splits long answers into chat messages.</li>
              <li>Sends only if it is confident and grounded; otherwise holds the reply for review and keeps watching.</li>
            </ol>
          </div>
        </aside>
      </div>
    </>
  );
}
