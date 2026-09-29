import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { User } from "../../shared/types";
import { api } from "../api";
import { Alert, Avatar, Icon } from "../components/ui";
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

function Art() {
  return (
    <div className="art">
      <div className="brand" style={{ padding: 0 }}><span className="logo">Q</span> FreshQA</div>
      <div>
        <h1>One agent per company. Every customer answered from your own knowledge.</h1>
        <p>Connect Freshchat, add what your team knows, and let the agent handle the chats. Your people take over any conversation with one click.</p>
        <div className="demo chat">
          <div className="msg customer"><Avatar name="Jane C" /><div className="bubble">Hi! Do you ship to Canada and how long does it take?</div></div>
          <div className="msg agent"><Avatar name="Ava" kind="bot" /><div className="bubble">Yes, we ship to Canada. Delivery takes 5–8 business days and costs a flat $15.</div></div>
          <div className="msg customer"><Avatar name="Jane C" /><div className="bubble">Perfect, thanks!</div></div>
        </div>
      </div>
      <p className="tiny" style={{ color: "#6b7a99" }}>Replies are grounded in your documents and cited. Low confidence hands off to a person, never a guess.</p>
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
    <div className="auth">
      <Art />
      <div className="form">
        <form className="auth-card page" onSubmit={onSubmit}>
          <h1>Welcome back</h1>
          <p>Sign in to your FreshQA account.</p>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="field"><label>Email</label><input type="email" name="email" required autoComplete="email" autoFocus /></div>
          <div className="field"><label>Password</label><input type="password" name="password" required autoComplete="current-password" /></div>
          <button className="primary" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>{busy ? "Signing in…" : "Sign in"} <Icon name="arrowRight" /></button>
          <p className="muted small" style={{ marginTop: "1.2rem", textAlign: "center" }}>
            New here? <Link to={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>
          </p>
        </form>
      </div>
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
    <div className="auth">
      <Art />
      <div className="form">
        <form className="auth-card page" onSubmit={onSubmit}>
          <h1>Create your account</h1>
          <p>Takes ten seconds. No email verification.</p>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="field"><label>Your name</label><input type="text" name="name" required autoComplete="name" autoFocus placeholder="Julius Callejo" /></div>
          <div className="field"><label>Email</label><input type="email" name="email" required autoComplete="email" placeholder="you@company.com" /></div>
          <div className="field"><label>Password</label><input type="password" name="password" required minLength={8} autoComplete="new-password" /><div className="hint">At least 8 characters.</div></div>
          <button className="primary" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>{busy ? "Creating…" : "Create account"} <Icon name="arrowRight" /></button>
          <p className="muted small" style={{ marginTop: "1.2rem", textAlign: "center" }}>
            Already have one? <Link to={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
