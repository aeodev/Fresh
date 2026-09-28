import { useEffect } from "react";
import { useLocation } from "react-router";
import { ConnectionSettings } from "../components/ConnectionSettings";
import { AgentSettingsForm } from "../components/AgentSettingsForm";
import { MembersPanel } from "../components/MembersPanel";
import { SidebarTokens } from "../components/SidebarTokens";
import { DangerZone } from "../components/DangerZone";
import { useCompany } from "./Company";

export function Settings() {
  const { allowed } = useCompany();
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const timer = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" }), 50);
    return () => clearTimeout(timer);
  }, [hash]);

  return (
    <>
      <section id="connection"><ConnectionSettings /></section>
      <section id="agent"><AgentSettingsForm /></section>
      <section id="sidebar">{allowed("sidebar.tokens") && <SidebarTokens />}</section>
      <section id="members"><MembersPanel /></section>
      <section id="danger"><DangerZone /></section>
    </>
  );
}
