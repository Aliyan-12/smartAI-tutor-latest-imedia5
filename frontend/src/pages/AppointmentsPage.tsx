import { useState, useEffect, useCallback } from "react";
import {
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  Users,
  ChevronDown,
  ChevronUp,
  Plus,
  AlertCircle,
} from "lucide-react";
import { appointmentsApi, teacherApi, parentApi, lessonsApi } from "../services/api";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import type { Appointment, User } from "../types";

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
                Teacher: <strong style={{ color: "var(--text-primary)" }}>{a.teacher_name}</strong>
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

// ── Booking form ──────────────────────────────────────────────────────────────
interface BookingFormProps {
  userRole: string;
  userId: number;
  onBooked: () => void;
}

function BookingForm({ userRole, userId, onBooked }: BookingFormProps) {
  const [open, setOpen] = useState(false);
  const [students, setStudents] = useState<User[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [availability, setAvailability] = useState<{ used: number; limit: number } | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  // Knowledge base filters
  const [kbSubjects, setKbSubjects] = useState<string[]>([]);
  const [kbStages, setKbStages] = useState<string[]>([]);
  const [kbUnits, setKbUnits] = useState<Array<{ id: number; title: string; unit_name: string }>>([]);
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);

  const [form, setForm] = useState({
    student_id: "",
    teacher_id: userRole === "teacher" ? String(userId) : "",
    subject: "",
    key_stage: "",
    title: "",
    scheduled_at: "",
    duration_minutes: "60",
    description: "",
    payment_amount: "",
    passcode: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      try {
        const filtersPromise = lessonsApi.getAvailableFilters();

        if (userRole === "teacher") {
          const [studentList, filters] = await Promise.all([
            teacherApi.getStudents() as Promise<User[]>,
            filtersPromise,
          ]);
          setStudents(studentList);
          setKbSubjects(filters.subjects);
          setKbStages(filters.key_stages);
        } else if (userRole === "parent") {
          const [studentList, teacherList, filters] = await Promise.all([
            parentApi.getStudents() as Promise<User[]>,
            appointmentsApi.getTeachers() as Promise<User[]>,
            filtersPromise,
          ]);
          setStudents(studentList);
          setTeachers(teacherList);
          setKbSubjects(filters.subjects);
          setKbStages(filters.key_stages);
        }
      } catch {}
    };
    load();
  }, [open, userRole]);

  // Load units when subject + key_stage change
  useEffect(() => {
    if (!form.subject || !form.key_stage) {
      setKbUnits([]);
      setSelectedUnits([]);
      return;
    }
    lessonsApi.getUnits(form.subject, form.key_stage).then((data) => {
      setKbUnits(data.units);
      setSelectedUnits([]);
    }).catch(() => setKbUnits([]));
  }, [form.subject, form.key_stage]);

  const toggleUnit = (unitName: string) => {
    setSelectedUnits((prev) =>
      prev.includes(unitName) ? prev.filter((u) => u !== unitName) : [...prev, unitName]
    );
  };

  const checkAvailability = async (studentId: number) => {
    if (!studentId) return;
    setLoadingAvailability(true);
    try {
      const data = (await appointmentsApi.checkAvailability(studentId)) as {
        used: number;
        limit: number;
      };
      // Guard against malformed response
      if (data && typeof data.used === "number" && typeof data.limit === "number") {
        setAvailability(data);
      } else {
        setAvailability(null);
      }
    } catch {
      setAvailability(null);
    } finally {
      setLoadingAvailability(false);
    }
  };

  const handleStudentChange = (studentId: string) => {
    setForm((f) => ({ ...f, student_id: studentId }));
    if (studentId) {
      checkAvailability(parseInt(studentId, 10));
    } else {
      setAvailability(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!form.student_id || !form.teacher_id || !form.subject || !form.title || !form.scheduled_at) {
      setError("Please fill in all required fields.");
      return;
    }

    setSubmitting(true);
    try {
      await appointmentsApi.book({
        student_id: parseInt(form.student_id, 10),
        teacher_id: parseInt(form.teacher_id, 10),
        subject: form.subject,
        key_stage: form.key_stage,
        title: form.title,
        scheduled_at: new Date(form.scheduled_at).toISOString(),
        duration_minutes: parseInt(form.duration_minutes, 10) || 60,
        description: [
          selectedUnits.length > 0 ? `Topics: ${selectedUnits.join(", ")}` : "",
          form.description || "",
        ].filter(Boolean).join("\n") || undefined,
        payment_amount: form.payment_amount ? parseFloat(form.payment_amount) : undefined,
        passcode: form.passcode || undefined,
      });
      setSuccess("Appointment booked successfully!");
      setForm({
        student_id: "",
        teacher_id: "",
        subject: "",
        key_stage: "",
        title: "",
        scheduled_at: "",
        duration_minutes: "60",
        description: "",
        payment_amount: "",
        passcode: "",
      });
      setAvailability(null);
      onBooked();
    } catch (err: any) {
      setError(err.message || "Failed to book appointment.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dashboard-section" style={{ marginBottom: 16 }}>
      <div
        className="section-header"
        style={{ cursor: "pointer", marginBottom: open ? 16 : 0 }}
        onClick={() => setOpen((v) => !v)}
      >
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Plus size={16} />
          Book New Appointment
        </h2>
        <button
          className="btn-secondary"
          style={{ display: "flex", alignItems: "center", gap: 4 }}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        >
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {open ? "Collapse" : "Expand"}
        </button>
      </div>

      {open && (
        <form onSubmit={handleSubmit}>

          <div className="form-row">
            <select
              value={form.student_id}
              onChange={(e) => handleStudentChange(e.target.value)}
              required
            >
              <option value="">Select Student *</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            {userRole === "parent" ? (
              <select
                value={form.teacher_id}
                onChange={(e) => setForm((f) => ({ ...f, teacher_id: e.target.value }))}
                required
              >
                <option value="">Select Teacher *</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : (
              // Teacher books on behalf — teacher_id is their own
              // We pass a hidden field resolved at submit, but show a placeholder
              <input
                type="text"
                placeholder="Teacher (you)"
                disabled
                style={{ background: "var(--bg-tertiary)", cursor: "not-allowed" }}
              />
            )}
          </div>

          <div className="form-row">
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>Subject *</label>
              <select value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value, key_stage: "", title: "" }))} required style={{ width: "100%" }}>
                <option value="">Select Subject</option>
                {kbSubjects.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>Key Stage *</label>
              <select value={form.key_stage} onChange={(e) => setForm((f) => ({ ...f, key_stage: e.target.value }))} required style={{ width: "100%" }}>
                <option value="">Select Key Stage</option>
                {kbStages.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>Session Title *</label>
              <input type="text" placeholder="e.g. Cell Structure Revision" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required style={{ width: "100%" }} />
            </div>
          </div>

          {/* Units/Topics from knowledge base */}
          {kbUnits.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>
                Select Topics/Units to Cover ({selectedUnits.length} selected)
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {kbUnits.map((unit) => {
                  const isSelected = selectedUnits.includes(unit.unit_name);
                  return (
                    <button
                      key={unit.id}
                      type="button"
                      onClick={() => toggleUnit(unit.unit_name)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 16,
                        fontSize: 12,
                        fontWeight: 500,
                        border: isSelected ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                        background: isSelected ? "var(--accent)" : "var(--bg-secondary)",
                        color: isSelected ? "white" : "var(--text-primary)",
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      {unit.title}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {form.subject && form.key_stage && kbUnits.length === 0 && (
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              No documents found for {form.subject} {form.key_stage}. Upload materials in the Knowledge Base first, or the AI will use general knowledge.
            </p>
          )}

          <div className="form-row">
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>
                Date &amp; Time *
              </label>
              <input
                type="datetime-local"
                value={form.scheduled_at}
                onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))}
                required
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>
                Duration (minutes)
              </label>
              <select
                value={form.duration_minutes}
                onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))}
                style={{ width: "100%" }}
              >
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
                <option value="90">90 minutes</option>
                <option value="120">2 hours</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>
                Payment amount (£)
              </label>
              <input
                type="number"
                placeholder="e.g. 25.00"
                value={form.payment_amount}
                onChange={(e) => setForm((f) => ({ ...f, payment_amount: e.target.value }))}
                min="0"
                step="0.01"
                style={{ width: "100%" }}
              />
            </div>
          </div>

          <div className="form-row">
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>
                Session Passcode (optional)
              </label>
              <input
                type="text"
                placeholder="e.g. ABC123"
                value={form.passcode}
                onChange={(e) => setForm((f) => ({ ...f, passcode: e.target.value.toUpperCase() }))}
                maxLength={16}
                style={{ width: "100%", letterSpacing: 2 }}
              />
            </div>
          </div>

          <div className="form-row">
            <textarea
              placeholder="Description / notes (optional)"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              style={{
                flex: 1,
                padding: "8px 10px",
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                color: "var(--text-primary)",
                fontSize: 13,
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </div>

          {error && (
            <p style={{ fontSize: 13, color: "var(--danger)", marginBottom: 10 }}>{error}</p>
          )}
          {success && (
            <p style={{ fontSize: 13, color: "var(--success)", fontWeight: 600, marginBottom: 10 }}>
              {success}
            </p>
          )}

          <div className="form-actions">
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting}
            >
              <Calendar size={14} />
              {submitting ? "Booking…" : "Book Appointment"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
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

          {/* Booking form */}
          {user && (user.role === "teacher" || user.role === "parent") && (
            <BookingForm userRole={user.role} userId={user.id} onBooked={loadAppointments} />
          )}

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
              <div style={{ padding: "40px 0", textAlign: "center" }}>
                <div className="typing-indicator" style={{ justifyContent: "center" }}>
                  <span /><span /><span />
                </div>
              </div>
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
                    Use the booking form above to schedule a new session.
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
