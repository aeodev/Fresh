import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api";
import { useSession } from "../session";

export function Invite() {
  const { token = "" } = useParams();
  const { user, loading } = useSession();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<{ companyName: string; email: string; role: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ invite: { companyName: string; email: string; role: string } }>(`/api/invites/${token}`).then((r) => setInvite(r.invite)).catch((e) => setError(e.message));
  }, [token]);

  const accept = async () => {
    setBusy(true);
    try {
      const result = await api<{ slug: string }>(`/api/invites/${token}/accept`, { body: {} });
      navigate(`/c/${result.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept the invite.");
      setBusy(false);
    }
  };

  const next = encodeURIComponent(`/invite/${token}`);
  return (
    <div className="page-center">
      <div className="auth-card">
        <h1>Team invite</h1>
        {error && <div className="alert error">{error}</div>}
        {invite && (
          <>
            <p>You are invited to join <strong>{invite.companyName}</strong> as <strong>{invite.role}</strong>.</p>
            <p className="muted small">Sent to {invite.email}.</p>
            {loading ? null : user ? (
              user.email.toLowerCase() === invite.email ? (
                <button className="primary" disabled={busy} onClick={() => void accept()}>{busy ? "Joining…" : "Accept and join"}</button>
              ) : (
                <div className="alert warn">You are signed in as {user.email}. Sign in with {invite.email} to accept.</div>
              )
            ) : (
              <div className="row">
                <Link className="btn primary" to={`/signup?next=${next}`}>Create account</Link>
                <Link className="btn" to={`/login?next=${next}`}>Sign in</Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
