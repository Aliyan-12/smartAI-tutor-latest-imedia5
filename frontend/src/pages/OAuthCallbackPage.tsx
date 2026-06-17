import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/**
 * Consumes the JWT handed back by the backend OAuth callback. The backend
 * redirects to `/oauth/callback#token=<jwt>` (fragment, so the token isn't sent
 * to servers/logs). We store it, then let RoleRouter route by role/onboarding.
 */
export default function OAuthCallbackPage() {
  const { setSessionToken } = useAuth();
  const navigate = useNavigate();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const token = params.get("token");
    if (token) {
      setSessionToken(token);
      navigate("/", { replace: true });
    } else {
      navigate("/login?error=oauth_failed", { replace: true });
    }
  }, [setSessionToken, navigate]);

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#0a0a15", color: "#fff", fontFamily: "DM Sans, sans-serif" }}>
      Signing you in…
    </div>
  );
}
