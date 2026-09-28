import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { User } from "../../shared/types";
import { api } from "../api";
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

export function Login() {
  const { submit, error, busy, next } = useAuthForm("/api/auth/login");
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void submit({ email: String(data.get("email")), password: String(data.get("password")) });
  };
  return (
    <div className="page-center">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>Sign in to FreshQA</h1>
        {error && <div className="alert error">{error}</div>}
        <div className="field"><label>Email</label><input type="email" name="email" required autoComplete="email" /></div>
        <div className="field"><label>Password</label><input type="password" name="password" required autoComplete="current-password" /></div>
        <button className="primary" disabled={busy} style={{ width: "100%" }}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="muted small" style={{ marginTop: "1rem" }}>
          No account? <Link to={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Create one</Link>
        </p>
      </form>
    </div>
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
    <div className="page-center">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>Create your account</h1>
        {error && <div className="alert error">{error}</div>}
        <div className="field"><label>Your name</label><input type="text" name="name" required autoComplete="name" /></div>
        <div className="field"><label>Email</label><input type="email" name="email" required autoComplete="email" /></div>
        <div className="field"><label>Password</label><input type="password" name="password" required minLength={8} autoComplete="new-password" /><div className="hint">At least 8 characters.</div></div>
        <button className="primary" disabled={busy} style={{ width: "100%" }}>{busy ? "Creating…" : "Create account"}</button>
        <p className="muted small" style={{ marginTop: "1rem" }}>
          Already have one? <Link to={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link>
        </p>
      </form>
    </div>
  );
}
