import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { authApi } from "../services/api";
import { useAuth } from "../context/AuthContext";
import type { AuthResponse } from "../types";

const wrap: React.CSSProperties = {
  display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center",
  background: "linear-gradient(160deg,#0a0a15,#111127 55%,#0d1a2e)", padding: 24,
  fontFamily: "DM Sans, -apple-system, sans-serif",
};
const card: React.CSSProperties = {
  width: "100%", maxWidth: 440, background: "#fff", borderRadius: 18, padding: "36px 32px",
  textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
};
const btn: React.CSSProperties = {
  width: "100%", padding: 13, background: "#1a73e8", color: "#fff", border: "none",
  borderRadius: 9, fontSize: 15, fontWeight: 700, cursor: "pointer", marginTop: 8,
};

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { applyAuth } = useAuth();

  const token = params.get("token");
  const email = params.get("email") || "";

  // token present → verifying; else → "check your inbox"
  const [state, setState] = useState<"verifying" | "sent" | "error" | "pending">(token ? "verifying" : "sent");
  const [message, setMessage] = useState("");
  const [resent, setResent] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    authApi
      .verifyEmail(token)
      .then((data) => {
        const res = data as { status?: string; access_token?: string; message?: string };
        // School admins are verified but still await administrator approval.
        if (res.status === "pending_approval" || !res.access_token) {
          setState("pending");
          setMessage(res.message || "Your account will be reviewed by an administrator.");
          return;
        }
        applyAuth(data as AuthResponse);
        navigate("/", { replace: true });
      })
      .catch((e: unknown) => {
        setState("error");
        setMessage(e instanceof Error ? e.message : "Verification failed");
      });
  }, [token, applyAuth, navigate]);

  const resend = async () => {
    if (!email) return;
    try { await authApi.resendVerification(email); setResent(true); } catch { /* ignore */ }
  };

  return (
    <div style={wrap}>
      <div style={card}>
        <img src="/images/aitutor 4 schools.png" alt="AI Tutor 4 Schools" style={{ height: 64, marginBottom: 16 }} />
        {state === "verifying" && (
          <>
            <h2 style={{ margin: "0 0 8px", color: "#1e293b" }}>Verifying…</h2>
            <p style={{ color: "#64748b" }}>Confirming your email address.</p>
          </>
        )}
        {state === "sent" && (
          <>
            <div style={{ fontSize: 44, marginBottom: 8 }}>📧</div>
            <h2 style={{ margin: "0 0 8px", color: "#1e293b" }}>Check your inbox</h2>
            <p style={{ color: "#64748b", lineHeight: 1.6 }}>
              We've sent a verification link to{email ? <> <strong>{email}</strong></> : " your email"}.
              Click it to activate your account.
            </p>
            <button style={{ ...btn, background: resent ? "#10b981" : "#1a73e8" }} onClick={resend} disabled={resent}>
              {resent ? "Verification email resent ✓" : "Resend email"}
            </button>
          </>
        )}
        {state === "pending" && (
          <>
            <div style={{ fontSize: 44, marginBottom: 8 }}>⏳</div>
            <h2 style={{ margin: "0 0 8px", color: "#1e293b" }}>Email verified — pending approval</h2>
            <p style={{ color: "#64748b", lineHeight: 1.6 }}>{message}</p>
            <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 10 }}>
              We'll email you as soon as your school account is approved. You can then sign in.
            </p>
          </>
        )}
        {state === "error" && (
          <>
            <div style={{ fontSize: 44, marginBottom: 8 }}>⚠️</div>
            <h2 style={{ margin: "0 0 8px", color: "#1e293b" }}>Link invalid or expired</h2>
            <p style={{ color: "#64748b" }}>{message}</p>
            {email && (
              <button style={btn} onClick={resend} disabled={resent}>
                {resent ? "New link sent ✓" : "Send a new link"}
              </button>
            )}
          </>
        )}
        <p style={{ marginTop: 18, fontSize: 13, color: "#64748b" }}>
          <Link to="/login" style={{ color: "#1a73e8", fontWeight: 600 }}>Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
