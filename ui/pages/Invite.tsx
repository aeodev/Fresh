import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api";
import { Alert, Avatar, Icon } from "../components/ui";
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
    <div className="auth">
      <div className="card page" style={{ textAlign: "center" }}>
        {invite && <div style={{ display: "grid", placeItems: "center", marginBottom: "1rem" }}><Avatar name={invite.companyName} size="lg" /></div>}
        <h1 className="display">{invite ? <>Join <em>{invite.companyName}</em>.</> : "Team invite"}</h1>
        {error && <div style={{ marginTop: "1rem", textAlign: "left" }}><Alert tone="error">{error}</Alert></div>}
        {invite && (
          <>
            <p className="sub">You are invited as <strong>{invite.role}</strong>. Sent to {invite.email}.</p>
            {loading ? null : user ? (
              user.email.toLowerCase() === invite.email ? (
                <button className="primary" disabled={busy} onClick={() => void accept()}>{busy ? "Joining…" : <><Icon name="check" /> Accept and join</>}</button>
              ) : (
                <Alert tone="warn">You are signed in as {user.email}. Sign in with {invite.email} to accept.</Alert>
              )
            ) : (
              <div className="row" style={{ justifyContent: "center" }}>
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
