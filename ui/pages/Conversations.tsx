import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { ConversationRow } from "../../shared/types";
import { api, timeAgo } from "../api";
import { Alert, Avatar, Chip, EmptyState, Icon, PageHeader, Skeleton } from "../components/ui";
import { useCompany } from "./Company";

const FILTERS: Array<{ key: string; label: string; query: string }> = [
  { key: "all", label: "All", query: "" },
  { key: "agent", label: "Agent", query: "state=agent" },
  { key: "human", label: "People", query: "state=human" },
  { key: "attention", label: "Attention", query: "attention=1" },
  { key: "resolved", label: "Resolved", query: "state=resolved" },
];

export function StateChip({ state }: { state: ConversationRow["state"] }) {
  return <Chip tone={state} dot>{state === "agent" ? "Agent" : state === "human" ? "Person" : "Resolved"}</Chip>;
}

export function Conversations() {
  const { company } = useCompany();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const active = FILTERS.find((f) => (f.key === "attention" ? params.get("attention") === "1" : f.query === (params.get("state") ? `state=${params.get("state")}` : ""))) ?? FILTERS[0];
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    setRows(null);
    api<{ conversations: ConversationRow[] }>(`/api/companies/${company.slug}/conversations?${active.query}&limit=100`).then((r) => setRows(r.conversations)).catch((e) => setError(e.message));
  }, [company.slug, active.query]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !rows) return rows;
    return rows.filter((c) => (c.customerName ?? "").toLowerCase().includes(needle) || c.lastMessagePreview.toLowerCase().includes(needle) || c.id.includes(needle));
  }, [rows, q]);

  return (
    <>
      <PageHeader eyebrow="Conversations" title="Every chat the agent has seen" subtitle="Newest activity first. Click a row to see the transcript and every decision." />
      <div className="card flush">
        <div className="card-header" style={{ alignItems: "center" }}>
          <div className="segmented">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" className={f.key === active.key ? "active" : ""} onClick={() => setParams(f.query ? new URLSearchParams(f.query) : new URLSearchParams())}>{f.label}</button>
            ))}
          </div>
          <div className="search" style={{ minWidth: 240 }}><Icon name="search" /><input type="search" placeholder="Search name or message" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {error && <div style={{ padding: "0 1.35rem" }}><Alert tone="error">{error}</Alert></div>}
        {visible === null ? <div style={{ padding: "1rem 1.35rem" }}><Skeleton lines={4} title={false} /></div> : visible.length === 0 ? (
          <EmptyState icon="chat" title={rows && rows.length ? "No matches" : "No conversations yet"}>
            {rows && rows.length ? "Try a different search." : "They appear here the moment Freshchat sends the first event. Test the agent meanwhile in Test chat."}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th style={{ width: 44 }}></th><th>Customer</th><th>State</th><th>Last message</th><th>Turns</th><th>Updated</th></tr></thead>
              <tbody>
                {visible.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => navigate(`/c/${company.slug}/conversations/${encodeURIComponent(c.id)}`)}>
                    <td><Avatar name={c.customerName || c.id} /></td>
                    <td><strong>{c.customerName || <span className="mono">{c.id.slice(0, 8)}</span>}</strong>{c.needsAttention && <div><Chip tone="warn">needs attention</Chip></div>}</td>
                    <td><StateChip state={c.state} /><div className="muted tiny truncate" style={{ maxWidth: 220 }}>{c.stateReason}</div></td>
                    <td className="muted truncate" style={{ maxWidth: 320 }}>{c.lastMessagePreview || "—"}</td>
                    <td>{c.turnCount}</td>
                    <td className="muted small" style={{ whiteSpace: "nowrap" }}>{timeAgo(c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
