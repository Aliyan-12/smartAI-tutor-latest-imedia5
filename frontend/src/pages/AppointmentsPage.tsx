import { useState, useEffect, useCallback } from "react";
import {
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  Users,
} from "lucide-react";
import { appointmentsApi } from "../services/api";
import Sidebar from "../components/Sidebar";
import { SkeletonList } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import type { Appointment } from "../types";

// ── Status helpers ────────────────────────────────────────────────────────────
const STATUS_STYLES: Record<
  string,
  { bg: string; color: string; border: string; label: string }
> = {
  booked: {
    bg: "var(--accent-light)",
    color: "var(--accent)",
    border: "rgba(26,115,232,0.2)",
    label: "Booked",
  },
  confirmed: {
    bg: "var(--success-light)",
    color: "var(--success)",
    border: "rgba(24,128,56,0.2)",
    label: "Confirmed",
  },
  started: {
    bg: "rgba(99,102,241,0.1)",
    color: "#6366f1",
    border: "rgba(99,102,241,0.25)",
    label: "In Progress",
  },
  paused: {
    bg: "rgba(217,119,6,0.1)",
    color: "#d97706",
    border: "rgba(217,119,6,0.25)",
    label: "Paused",
  },
  terminated: {
    bg: "var(--bg-tertiary)",
    color: "var(--text-secondary)",
    border: "var(--border)",
    label: "Terminated",
  },
  completed: {
    bg: "var(--bg-tertiary)",
    color: "var(--text-secondary)",
    border: "var(--border)",
    label: "Completed",
  },
  cancelled: {
    bg: "var(--danger-light)",
    color: "var(--danger)",
    border: "rgba(217,48,37,0.2)",
    label: "Cancelled",
  },
};

const PAYMENT_STYLES: Record<
  Appointment["payment_status"],
  { color: string; label: string }
> = {
  pending: { color: "var(--warning)", label: "Payment Pending" },
  paid: { color: "var(--success)", label: "Paid" },
  refunded: { color: "var(--text-secondary)", label: "Refunded" },
};

function StatusBadge({ status }: { status: Appointment["status"] }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      style={{
        padding: "2px 10px",
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.4px",
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

function PaymentBadge({ status }: { status: Appointment["payment_status"] }) {
  const p = PAYMENT_STYLES[status];
  return (
    <span style={{ fontSize: 12, color: p.color, fontWeight: 600 }}>
      {p.label}
    </span>
  );
}

// ── Appointment card ──────────────────────────────────────────────────────────
interface AppointmentCardProps {
  appointment: Appointment;
  userRole: string;
  onStatusUpdate: (id: number, status: string) => void;
  updating: boolean;
}

function AppointmentCard({ appointment: a, userRole, onStatusUpdate, updating }: AppointmentCardProps) {
  const scheduledDate = new Date(a.scheduled_at);
  const isPast = scheduledDate < new Date();

  const canConfirm = a.status === "booked" && userRole === "parent";
  const canComplete = a.status === "confirmed" && (userRole === "teacher" || isPast);
  const canCancel = a.status !== "completed" && a.status !== "cancelled";

  return (
    <div
      style={{
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "16px 20px",
        marginBottom: 10,
        borderLeft: `3px solid ${STATUS_STYLES[a.status].color}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--radius)",
            background: STATUS_STYLES[a.status].bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Calendar size={18} style={{ color: STATUS_STYLES[a.status].color }} />
        </div>

        {/* Main info */}
        <div style={{ flex: 1, minWidth: 220 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 5,
            }}
          >
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
              {a.title}
            </h3>
            <StatusBadge status={a.status} />
            <PaymentBadge status={a.payment_status} />
          </div>

          <div
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              fontSize: 13,
              color: "var(--text-secondary)",
            }}
          >
            {a.student_name && (
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <Users size={12} />
                Student: <strong style={{ color: "var(--text-primary)" }}>{a.student_name}</strong>
              </span>
            )}
            {a.teacher_name && (
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <Users size={12} />
                AI Tutor: <strong style={{ color: "var(--text-primary)" }}>{a.teacher_name}</strong>
              </span>
            )}
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Clock size={12} />
              {scheduledDate.toLocaleDateString("en-GB", {
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              })}{" "}
              at{" "}
              {scheduledDate.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              })}
              {a.duration_minutes && ` (${a.duration_minutes} min)`}
            </span>
            <span>
              {a.subject}
              {a.key_stage && ` · ${a.key_stage}`}
            </span>
          </div>

          {a.description && (
            <p
              style={{
                fontSize: 13,
                color: "var(--text-muted)",
                marginTop: 6,
                lineHeight: 1.5,
              }}
            >
              {a.description}
            </p>
          )}

          {a.meeting_link && (
            <a
              href={a.meeting_link}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 13, color: "var(--accent)", marginTop: 5, display: "inline-block" }}
            >
              Join meeting
            </a>
          )}
        </div>

        {/* Action buttons */}
        {(canConfirm || canComplete || canCancel) && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
            {canConfirm && (
              <button
                className="btn-primary"
                disabled={updating}
                onClick={() => onStatusUpdate(a.id, "confirmed")}
                style={{ fontSize: 12, padding: "6px 12px" }}
              >
                <CheckCircle size={13} />
                Confirm
              </button>
            )}
            {canComplete && (
              <button
                className="btn-secondary"
                disabled={updating}
                onClick={() => onStatusUpdate(a.id, "completed")}
                style={{ fontSize: 12, padding: "6px 12px", display: "flex", alignItems: "center", gap: 4 }}
              >
                <CheckCircle size={13} style={{ color: "var(--success)" }} />
                Mark Done
              </button>
            )}
            {canCancel && (
              <button
                disabled={updating}
                onClick={() => onStatusUpdate(a.id, "cancelled")}
                style={{
                  fontSize: 12,
                  padding: "6px 12px",
                  background: "var(--danger-light)",
                  color: "var(--danger)",
                  border: "1px solid rgba(217,48,37,0.2)",
                  borderRadius: "var(--radius)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontWeight: 600,
                  cursor: "pointer",
                  opacity: updating ? 0.6 : 1,
                }}
              >
                <XCircle size={13} />
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AppointmentsPage() {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("");

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = (await appointmentsApi.list(filterStatus || undefined)) as Appointment[];
      setAppointments(data);
    } catch (err: any) {
      setError(err.message || "Failed to load appointments");
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  const handleStatusUpdate = async (id: number, status: string) => {
    setUpdatingId(id);
    try {
      await appointmentsApi.updateStatus(id, status);
      setAppointments((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, status: status as Appointment["status"] } : a
        )
      );
    } catch (err: any) {
      setError(err.message || "Failed to update appointment status");
    } finally {
      setUpdatingId(null);
    }
  };

  const upcoming = appointments.filter(
    (a) => a.status !== "cancelled" && a.status !== "completed" && new Date(a.scheduled_at) >= new Date()
  );
  const past = appointments.filter(
    (a) => a.status === "completed" || new Date(a.scheduled_at) < new Date()
  );
  const cancelled = appointments.filter((a) => a.status === "cancelled");

  const displayAppointments = filterStatus
    ? appointments.filter((a) => a.status === filterStatus)
    : appointments;

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content">
          <div className="dashboard-page-header">
            <h1>Appointments</h1>
          </div>

          {error && <div className="dashboard-error">{error}</div>}

          {/* Summary stats */}
          <div className="stats-grid" style={{ marginBottom: 18 }}>
            <div className="stat-card">
              <Calendar size={18} />
              <div className="stat-value">{upcoming.length}</div>
              <div className="stat-label">Upcoming</div>
            </div>
            <div className="stat-card">
              <CheckCircle size={18} />
              <div className="stat-value">{past.length}</div>
              <div className="stat-label">Completed</div>
            </div>
            <div className="stat-card">
              <XCircle size={18} />
              <div className="stat-value">{cancelled.length}</div>
              <div className="stat-label">Cancelled</div>
            </div>
          </div>

          {/* Filter & list */}
          <div className="dashboard-section">
            <div className="section-header">
              <h2>
                {filterStatus
                  ? `${STATUS_STYLES[filterStatus as Appointment["status"]]?.label ?? filterStatus} Appointments`
                  : "All Appointments"}
              </h2>
              <div className="section-actions">
                <select
                  className="filter-select"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                >
                  <option value="">All Statuses</option>
                  <option value="booked">Booked</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <button className="btn-secondary" onClick={loadAppointments}>
                  Refresh
                </button>
              </div>
            </div>

            {loading ? (
              <div style={{ padding: 16 }}><SkeletonList rows={5} /></div>
            ) : displayAppointments.length === 0 ? (
              <div
                style={{
                  padding: "32px 0",
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: 14,
                }}
              >
                <Calendar size={28} style={{ marginBottom: 10, opacity: 0.4 }} />
                <p>No appointments found.</p>
                {!filterStatus && user && (user.role === "teacher" || user.role === "parent") && (
                  <p style={{ fontSize: 13, marginTop: 4 }}>
                    Use the Book Appointment page to schedule a new session.
                  </p>
                )}
              </div>
            ) : (
              <div>
                {displayAppointments.map((a) => (
                  <AppointmentCard
                    key={a.id}
                    appointment={a}
                    userRole={user?.role ?? ""}
                    onStatusUpdate={handleStatusUpdate}
                    updating={updatingId === a.id}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
