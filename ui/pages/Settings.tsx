import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { AgentSettingsForm } from "../components/AgentSettingsForm";
import { ConnectionSettings } from "../components/ConnectionSettings";
import { DangerZone } from "../components/DangerZone";
import { MembersPanel } from "../components/MembersPanel";
import { SidebarTokens } from "../components/SidebarTokens";
import { Icon, PageHead, type IconName } from "../components/ui";
import { useCompany } from "./Company";

const SECTIONS: Array<{ id: string; label: string; icon: IconName }> = [
  { id: "connection", label: "Freshchat", icon: "link" },
  { id: "agent", label: "Agent", icon: "sparkles" },
  { id: "sidebar", label: "Sidebar app", icon: "bot" },
  { id: "members", label: "Members", icon: "users" },
  { id: "company", label: "Company", icon: "building" },
];

export function Settings() {
  const { allowed } = useCompany();
  const { hash } = useLocation();
  const [current, setCurrent] = useState(hash.slice(1) || "connection");

  useEffect(() => {
    if (!hash) return;
    setCurrent(hash.slice(1));
    const timer = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
    return () => clearTimeout(timer);
  }, [hash]);

  const go = (id: string) => {
    setCurrent(id);
    document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <>
      <PageHead title={<>Connection, agent, <em>team</em>.</>} subtitle="Everything that configures this company." />
      <div className="settings">
        <nav className="index">
          {SECTIONS.filter((s) => s.id !== "sidebar" || allowed("sidebar.tokens")).map((s) => (
            <a key={s.id} href={`#${s.id}`} className={current === s.id ? "on" : ""} onClick={(e) => { e.preventDefault(); go(s.id); }}><Icon name={s.icon} size={16} /> {s.label}</a>
          ))}
        </nav>
        <div className="body">
          <section id="connection" style={{ scrollMarginTop: 90 }}><ConnectionSettings /></section>
          <section id="agent" style={{ scrollMarginTop: 90 }}><AgentSettingsForm /></section>
          {allowed("sidebar.tokens") && <section id="sidebar" style={{ scrollMarginTop: 90 }}><SidebarTokens /></section>}
          <section id="members" style={{ scrollMarginTop: 90 }}><MembersPanel /></section>
          <section id="company" style={{ scrollMarginTop: 90 }}><DangerZone /></section>
        </div>
      </div>
    </>
  );
}
