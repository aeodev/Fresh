import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router";
import { can, type Permission } from "../../shared/rbac";
import type { CompanyDetail } from "../../shared/types";
import { api } from "../api";
import { useSession } from "../session";

type CompanyContextValue = { company: CompanyDetail; reload: () => Promise<void>; allowed: (permission: Permission) => boolean };
const CompanyContext = createContext<CompanyContextValue | null>(null);

export function useCompany() {
  const value = useContext(CompanyContext);
  if (!value) throw new Error("useCompany must be used inside the company layout");
  return value;
}

export function ModePill({ mode }: { mode: CompanyDetail["mode"] }) {
  return <span className={`pill ${mode}`}>{mode === "off" ? "Agent off" : mode === "shadow" ? "Shadow mode" : "Live"}</span>;
}

export function Company() {
  const { slug = "" } = useParams();
  const { user, logout } = useSession();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const result = await api<{ company: CompanyDetail }>(`/api/companies/${slug}`);
      setCompany(result.company);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the company.");
    }
  }, [slug]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) {
    return (
      <div className="page-center">
        <div className="auth-card">
          <div className="alert error">{error}</div>
          <Link to="/">Back to your companies</Link>
        </div>
      </div>
    );
  }
  if (!company) return <div className="page-center muted">Loading…</div>;

  const allowed = (permission: Permission) => can(company.role, permission);
  const nav = ({ isActive }: { isActive: boolean }) => `nav ${isActive ? "active" : ""}`;

  return (
    <CompanyContext.Provider value={{ company, reload, allowed }}>
      <div className="shell">
        <nav className="sidenav">
          <div className="brand"><span>Q</span> FreshQA</div>
          <NavLink to={`/c/${slug}`} end className={nav}>Overview</NavLink>
          <NavLink to={`/c/${slug}/conversations`} className={nav}>Conversations</NavLink>
          <NavLink to={`/c/${slug}/knowledge`} className={nav}>Knowledge</NavLink>
          <NavLink to={`/c/${slug}/test`} className={nav}>Test chat</NavLink>
          <NavLink to={`/c/${slug}/activity`} className={nav}>Activity</NavLink>
          <NavLink to={`/c/${slug}/settings`} className={nav}>Settings</NavLink>
          <div className="spacer" />
          <Link to="/" className="nav">← All companies</Link>
          <div className="muted small" style={{ padding: "0.5rem 0.65rem" }}>
            {user?.name}<br />
            <button className="link-button small" onClick={() => void logout()}>Sign out</button>
          </div>
        </nav>
        <main className="main">
          <div className="topbar">
            <div className="title">
              <h1>{company.name}</h1>
              <ModePill mode={company.mode} />
              <span className="pill">{company.role}</span>
            </div>
          </div>
          <Outlet />
        </main>
      </div>
    </CompanyContext.Provider>
  );
}
