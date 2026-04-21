import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { appointmentsApi } from "../services/api";
import type { Appointment } from "../types";
import PostSessionScreen from "../components/PostSessionScreen";

export default function SessionReportPage() {
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const navigate = useNavigate();
  const [appt, setAppt] = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appointmentId) return;
    appointmentsApi
      .get(parseInt(appointmentId))
      .then((a: any) => setAppt(a as Appointment))
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [appointmentId]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", flexDirection: "column", gap: 12, color: "var(--text-muted)" }}>
        <div style={{ width: 32, height: 32, border: "3px solid #e2e8f0", borderTopColor: "#3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <p style={{ fontSize: 14 }}>Loading session report…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !appt) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", flexDirection: "column", gap: 12 }}>
        <p style={{ fontSize: 14, color: "var(--text-muted)" }}>{error ?? "Appointment not found."}</p>
        <button onClick={() => navigate("/sessions")} style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid var(--border-color)", background: "var(--bg-secondary)", cursor: "pointer", fontSize: 13 }}>
          ← Back to Sessions
        </button>
      </div>
    );
  }

  return (
    <PostSessionScreen
      appointmentId={appt.id}
      sessionTitle={appt.title}
      sessionSubject={appt.subject}
      durationMinutes={appt.duration_minutes}
    />
  );
}
