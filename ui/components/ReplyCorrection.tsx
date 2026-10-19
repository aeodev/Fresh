import { useState } from "react";
import type { Draft, KnowledgeVersion } from "../../shared/types";
import { api } from "../api";
import { useCompany } from "../pages/Company";
import { Alert } from "./ui";

type Proposal = { id: string; title: string; before: string; after: string; reason: string; addsDocument: boolean };
export function ReplyCorrection({ question, result, onPublished, onRetry }: {
  question: string;
  result: { draft: Draft | null; version: { id: string; status: string }; retrieved: Array<{ id: string }> };
  onPublished: (version: KnowledgeVersion) => void;
  onRetry: (version: KnowledgeVersion) => void;
}) {
  const { company, allowed } = useCompany();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState(result.draft?.answer ?? "");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [published, setPublished] = useState<KnowledgeVersion | null>(null);
  if (!allowed("knowledge.write") || result.draft?.model === "greeting") return null;
  const preview = async () => {
    setWorking(true); setError(""); setProposal(null);
    try {
      const reply = await api<{ correction: Proposal }>(`/api/companies/${company.slug}/agent/corrections/preview`, { body: {
        versionId: result.version.id, question, originalAnswer: result.draft?.answer ?? "", correctedAnswer: answer,
        chunkIds: result.draft?.citations.length ? result.draft.citations.map(c => c.chunkId) : result.retrieved.map(c => c.id),
      } });
      setProposal(reply.correction);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not preview correction."); }
    finally { setWorking(false); }
  };
  const publish = async () => {
    if (!proposal) return;
    setWorking(true); setError("");
    try {
      const reply = await api<{ version: KnowledgeVersion }>(`/api/companies/${company.slug}/agent/corrections/${proposal.id}/publish`, { body: {} });
      setPublished(reply.version); onPublished(reply.version);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not publish correction."); }
    finally { setWorking(false); }
  };
  return <div className="reply-correction">
    {!open && !published && <button className="ghost sm" onClick={() => setOpen(true)}>Flag &amp; correct</button>}
    {published ? <>
      <Alert tone="info">Knowledge v{published.number} is live. The corrected answer was saved as a golden test.</Alert>
      <button className="ghost sm" onClick={() => onRetry(published)}>Test corrected answer</button>
    </> : open && <div className="stack" style={{ gap: "0.8rem" }}>
      <strong>Correct this answer</strong>
      <p className="small mute" style={{ margin: 0 }}>Write the correct facts. Review the source change before publishing. For tone or formatting, use Agent settings.</p>
      <label className="small">Correct answer
        <textarea value={answer} maxLength={2000} disabled={working} onChange={e => { setAnswer(e.target.value); setProposal(null); }} placeholder="What should the agent have answered?" />
      </label>
      {error && <Alert tone="error">{error}</Alert>}
      {proposal && <>
        <strong className="small">{proposal.addsDocument ? "New document" : "Source change"}: {proposal.title}</strong>
        <p className="small mute" style={{ margin: 0 }}>{proposal.reason}</p>
        {proposal.before && <div className="correction-before"><span className="label">Before</span><div>{proposal.before}</div></div>}
        <div className="correction-after"><span className="label">After</span><div>{proposal.after}</div></div>
        <p className="small mute" style={{ margin: 0 }}>Publishes a new version from active knowledge. Existing drafts stay separate. The previous live version remains available in Knowledge.</p>
      </>}
      <div className="row" style={{ flexWrap: "wrap" }}>
        {proposal ? <button className="primary sm" disabled={working || !allowed("knowledge.activate")} onClick={() => void publish()}>{working ? "Publishing…" : "Apply & publish"}</button>
          : <button className="primary sm" disabled={working || answer.trim().length < 20} onClick={() => void preview()}>{working ? "Preparing change…" : "Preview KB change"}</button>}
        <button className="ghost sm" disabled={working} onClick={() => { setOpen(false); setProposal(null); setError(""); }}>Cancel</button>
      </div>
      {!allowed("knowledge.activate") && <p className="small mute">An owner or admin must publish knowledge changes.</p>}
    </div>}
  </div>;
}
