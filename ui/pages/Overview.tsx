import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ConversationRow } from "../../shared/types";
import { api, timeAgo } from "../api";
import { useCompany } from "./Company";

export function Overview() {
  const { company } = useCompany();
  const [attention, setAttention] = useState<ConversationRow[]>([]);
  const base = `/c/${company.slug}`;
  const s = company.setup;

  useEffect(() => {
    api<{ conversations: ConversationRow[] }>(`/api/companies/${company.slug}/conversations?state=human&limit=10`).then((r) => setAttention(r.conversations)).catch(() => setAttention([]));
  }, [company.slug]);

  const steps: Array<{ done: boolean; label: string; to: string; hint: string }> = [
    { done: s.connected, label: "Connect Freshchat", to: `${base}/settings#connection`, hint: "API URL and key, verified by listing your agents." },
    { done: s.replyAgentSet, label: "Pick the reply agent", to: `${base}/settings#connection`, hint: "A dedicated agent seat the bot replies as." },
    { done: s.sidebarTokenIssued, label: "Install the Freshchat sidebar app", to: `${base}/settings#sidebar`, hint: "Gives agents Take over / Hand back and forwards events." },
    { done: s.knowledgeActive, label: "Activate a knowledge version", to: `${base}/knowledge`, hint: "The agent answers only from the active version." },
    { done: s.goldenTestsPassing === true, label: "Golden tests passing", to: `${base}/knowledge`, hint: s.goldenTestsPassing === null ? "Add a few question/answer pairs and run them." : s.goldenTestsPassing ? "All passing." : "Some tests fail; fix the documents." },
    { done: s.mode === "live", label: "Go live", to: `${base}/settings#agent`, hint: s.mode === "shadow" ? "Shadow mode is on: drafts are recorded, nothing is sent." : "Start in shadow mode, then switch to live." },
  ];
  const remaining = steps.filter((x) => !x.done).length;

  return (
    <>
      <div className="tiles">
        <div className="tile"><div className="value">{company.stats.conversationsToday}</div><div className="label">Conversations today</div></div>
        <div className="tile"><div className="value">{company.stats.sentToday}</div><div className="label">Replies sent today</div></div>
        <div className="tile"><div className="value">{company.stats.handoffsToday}</div><div className="label">Handoffs today</div></div>
        <div className="tile"><div className="value">{company.stats.humanNow}</div><div className="label">Chats owned by people</div></div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h2>Setup</h2><span className={`pill ${remaining ? "warn" : "ok"}`}>{remaining ? `${remaining} to go` : "Complete"}</span></div>
          <ul className="checklist">
            {steps.map((step) => (
              <li key={step.label}>
                <span className={`mark ${step.done ? "done" : ""}`}>{step.done ? "✓" : ""}</span>
                <div>
                  <Link to={step.to}><strong>{step.label}</strong></Link>
                  <div className="muted small">{step.hint}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="card-header"><h2>Needs a person</h2><Link to={`${base}/conversations?state=human`} className="small">All</Link></div>
          {attention.length === 0 ? (
            <p className="empty">No conversation is waiting on a person right now.</p>
          ) : (
            <table>
              <tbody>
                {attention.map((c) => (
                  <tr key={c.id}>
                    <td><Link to={`${base}/conversations/${encodeURIComponent(c.id)}`}>{c.customerName || c.id.slice(0, 8)}</Link><div className="muted small">{c.stateReason}</div></td>
                    <td className="muted small" style={{ whiteSpace: "nowrap" }}>{timeAgo(c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
