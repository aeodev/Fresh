import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { ConversationRow } from "../../shared/types";
import { api, timeAgo } from "../api";
import { useCompany } from "./Company";

const FILTERS: Array<{ key: string; label: string; query: string }> = [
  { key: "all", label: "All", query: "" },
  { key: "agent", label: "Agent replying", query: "state=agent" },
  { key: "human", label: "Owned by a person", query: "state=human" },
  { key: "attention", label: "Needs attention", query: "attention=1" },
  { key: "resolved", label: "Resolved", query: "state=resolved" },
];

export function StatePill({ state }: { state: ConversationRow["state"] }) {
  return <span className={`pill ${state}`}>{state === "agent" ? "Agent" : state === "human" ? "Person" : "Resolved"}</span>;
}

export function Conversations() {
  const { company } = useCompany();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const active = FILTERS.find((f) => (f.key === "attention" ? params.get("attention") === "1" : f.query === (params.get("state") ? `state=${params.get("state")}` : ""))) ?? FILTERS[0];
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    api<{ conversations: ConversationRow[] }>(`/api/companies/${company.slug}/conversations?${active.query}&limit=100`).then((r) => setRows(r.conversations)).catch((e) => setError(e.message));
  }, [company.slug, active.query]);

  return (
    <div className="card">
      <div className="card-header"><h2>Conversations</h2><span className="muted small">Newest activity first</span></div>
      <div className="filters">
        {FILTERS.map((f) => (
          <button key={f.key} className={`small ${f.key === active.key ? "active" : ""}`} onClick={() => setParams(f.query ? new URLSearchParams(f.query) : new URLSearchParams())}>{f.label}</button>
        ))}
      </div>
      {error && <div className="alert error">{error}</div>}
      {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? (
        <p className="empty">Nothing here yet. Conversations appear as soon as Freshchat sends the first event.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Customer</th><th>State</th><th>Last message</th><th>Turns</th><th>Updated</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => navigate(`/c/${company.slug}/conversations/${encodeURIComponent(c.id)}`)}>
                  <td>{c.customerName || <span className="mono">{c.id.slice(0, 8)}</span>}{c.needsAttention && <> <span className="pill warn">attention</span></>}</td>
                  <td><StatePill state={c.state} /><div className="muted small">{c.stateReason}</div></td>
                  <td className="muted">{c.lastMessagePreview || "—"}</td>
                  <td>{c.turnCount}</td>
                  <td className="muted small" style={{ whiteSpace: "nowrap" }}>{timeAgo(c.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
