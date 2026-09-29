import { useEffect } from "react";
import { useLocation } from "react-router";
import { ConnectionSettings } from "../components/ConnectionSettings";
import { AgentSettingsForm } from "../components/AgentSettingsForm";
import { MembersPanel } from "../components/MembersPanel";
import { SidebarTokens } from "../components/SidebarTokens";
import { DangerZone } from "../components/DangerZone";
import { PageHeader } from "../components/ui";
import { useCompany } from "./Company";

const SECTIONS = [
  { id: "connection", label: "Freshchat" },
  { id: "agent", label: "Agent" },
  { id: "sidebar", label: "Sidebar app" },
  { id: "members", label: "Members" },
  { id: "danger", label: "Company" },
];

export function Settings() {
  const { allowed } = useCompany();
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const timer = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
    return () => clearTimeout(timer);
  }, [hash]);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Connection, agent, and team"
        actions={<div className="segmented">{SECTIONS.map((s) => <button key={s.id} type="button" className={hash === `#${s.id}` ? "active" : ""} onClick={() => document.getElementById(s.id)?.scrollIntoView({ block: "start", behavior: "smooth" })}>{s.label}</button>)}</div>}
      />
      <div className="stack" style={{ gap: "1.2rem" }}>
        <section id="connection"><ConnectionSettings /></section>
        <section id="agent"><AgentSettingsForm /></section>
        {allowed("sidebar.tokens") && <section id="sidebar"><SidebarTokens /></section>}
        <section id="members"><MembersPanel /></section>
        <section id="danger"><DangerZone /></section>
      </div>
    </>
  );
}
