import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { User } from "../../shared/types";
import { api } from "../api";
import { Alert, Icon } from "../components/ui";
import { useSession } from "../session";

function useAuthForm(path: string) {
  const { setUser } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (body: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ user: User }>(path, { body });
      setUser(result.user);
      navigate(params.get("next") || "/", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  return { submit, error, busy, next: params.get("next") };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="card page">
        <div className="brand"><span className="mark">Q</span>FreshQA</div>
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const { submit, error, busy, next } = useAuthForm("/api/auth/login");
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void submit({ email: String(data.get("email")), password: String(data.get("password")) });
  };
  return (
    <Shell>
      <form onSubmit={onSubmit}>
        <h1 className="display">Welcome <em>back</em>.</h1>
        <p className="sub">Sign in to your workspace.</p>
        {error && <div style={{ marginBottom: "1rem" }}><Alert tone="error">{error}</Alert></div>}
        <div className="field"><label>Email</label><input type="email" name="email" required autoComplete="email" autoFocus /></div>
        <div className="field"><label>Password</label><input type="password" name="password" required autoComplete="current-password" /></div>
        <button className="primary" disabled={busy} style={{ width: "100%" }}>{busy ? "Signing in…" : "Sign in"} <Icon name="arrowRight" /></button>
        <p className="mute small" style={{ marginTop: "1.5rem", textAlign: "center" }}>New here? <Link className="link" to={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link></p>
      </form>
    </Shell>
  );
}

export function Signup() {
  const { submit, error, busy, next } = useAuthForm("/api/auth/signup");
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void submit({ name: String(data.get("name")), email: String(data.get("email")), password: String(data.get("password")) });
  };
  return (
    <Shell>
      <form onSubmit={onSubmit}>
        <h1 className="display">One agent, <em>every</em> customer.</h1>
        <p className="sub">Create your account. No email verification, no card.</p>
        {error && <div style={{ marginBottom: "1rem" }}><Alert tone="error">{error}</Alert></div>}
        <div className="field"><label>Your name</label><input type="text" name="name" required autoComplete="name" autoFocus placeholder="Julius Callejo" /></div>
        <div className="field"><label>Email</label><input type="email" name="email" required autoComplete="email" placeholder="you@company.com" /></div>
        <div className="field"><label>Password</label><input type="password" name="password" required minLength={8} autoComplete="new-password" /><div className="hint">At least 8 characters.</div></div>
        <button className="primary" disabled={busy} style={{ width: "100%" }}>{busy ? "Creating…" : "Create account"} <Icon name="arrowRight" /></button>
        <p className="mute small" style={{ marginTop: "1.5rem", textAlign: "center" }}>Already have one? <Link className="link" to={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link></p>
      </form>
    </Shell>
  );
}
