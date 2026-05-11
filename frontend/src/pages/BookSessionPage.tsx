import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calendar, ArrowLeft, User, Clock, BookOpen,
  CheckCircle, Info,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { appointmentsApi, teacherApi, parentApi, lessonsApi } from "../services/api";
import type { User as UserType } from "../types";

const SESSION_TYPES = [
  "Homework Help",
  "Revision",
  "Exam Prep",
  "General Tutoring",
  "Topic Introduction",
];

const DURATIONS = [
  { label: "30 minutes", value: "30" },
  { label: "60 minutes", value: "60" },
  { label: "90 minutes", value: "90" },
  { label: "2 hours", value: "120" },
];

export default function BookSessionPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isParent = user?.role === "parent";
  const isTeacher = user?.role === "teacher";

  const [students, setStudents] = useState<UserType[]>([]);
  const [teachers, setTeachers] = useState<UserType[]>([]);
  const [availability, setAvailability] = useState<{ used: number; limit: number } | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  const [kbSubjects, setKbSubjects] = useState<string[]>([]);
  const [kbStages, setKbStages] = useState<string[]>([]);
  const [kbUnits, setKbUnits] = useState<Array<{ id: number; title: string; unit_name: string }>>([]);
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);

  const [form, setForm] = useState({
    student_id: "",
    teacher_id: isTeacher ? String(user?.id ?? "") : "",
    subject: "",
    key_stage: "",
    session_type: "General Tutoring",
    title: "",
    date: "",
    time: "",
    duration_minutes: "60",
    description: "",
    payment_amount: "",
    passcode: "",
    require_passcode: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedStudent = students.find((s) => String(s.id) === form.student_id);
  const selectedTeacher = isTeacher
    ? { name: user?.name ?? "You" }
    : teachers.find((t) => String(t.id) === form.teacher_id);

  useEffect(() => {
    const load = async () => {
      try {
        const filtersPromise = lessonsApi.getAvailableFilters();
        if (isTeacher) {
          const [studentList, filters] = await Promise.all([
            teacherApi.getStudents() as Promise<UserType[]>,
            filtersPromise,
          ]);
          setStudents(studentList);
          setKbSubjects(filters.subjects);
          setKbStages(filters.key_stages);
        } else if (isParent) {
          const [studentList, teacherList, filters] = await Promise.all([
            parentApi.getStudents() as Promise<UserType[]>,
            appointmentsApi.getTeachers() as Promise<UserType[]>,
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
  }, [isTeacher, isParent]);

  useEffect(() => {
    if (!form.subject || !form.key_stage) {
      setKbUnits([]);
      setSelectedUnits([]);
      return;
    }
    lessonsApi
      .getUnits(form.subject, form.key_stage)
      .then((data) => {
        setKbUnits(data.units);
        setSelectedUnits([]);
      })
      .catch(() => setKbUnits([]));
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

  const handleStudentChange = (id: string) => {
    setForm((f) => ({ ...f, student_id: id }));
    if (id) checkAvailability(parseInt(id, 10));
    else setAvailability(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (
      !form.student_id ||
      !form.teacher_id ||
      !form.subject ||
      !form.title ||
      !form.date ||
      !form.time
    ) {
      setError("Please fill in all required fields.");
      return;
    }

    const scheduledAt = new Date(`${form.date}T${form.time}`).toISOString();
    setSubmitting(true);
    try {
      await appointmentsApi.book({
        student_id: parseInt(form.student_id, 10),
        teacher_id: parseInt(form.teacher_id, 10),
        subject: form.subject,
        key_stage: form.key_stage,
        title: form.title,
        scheduled_at: scheduledAt,
        duration_minutes: parseInt(form.duration_minutes, 10) || 60,
        description:
          [
            selectedUnits.length > 0 ? `Topics: ${selectedUnits.join(", ")}` : "",
            form.session_type ? `Session type: ${form.session_type}` : "",
            form.description || "",
          ]
            .filter(Boolean)
            .join("\n") || undefined,
        payment_amount: form.payment_amount ? parseFloat(form.payment_amount) : undefined,
        passcode:
          form.require_passcode && form.passcode ? form.passcode : undefined,
      });
      setSuccess("Session booked successfully!");
      setTimeout(() => navigate("/appointments"), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to book session.");
    } finally {
      setSubmitting(false);
    }
  };

  const formatDateTime = () => {
    if (!form.date || !form.time) return null;
    try {
      const d = new Date(`${form.date}T${form.time}`);
      return (
        d.toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        }) +
        " at " +
        d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      );
    } catch {
      return null;
    }
  };

  const summaryComplete = !!(
    form.student_id &&
    form.subject &&
    form.date &&
    form.time
  );

  // ── Shared form JSX ──────────────────────────────────────────────────
  const formContent = (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* Section: Participants */}
      <div style={sectionStyle}>
        <div style={sectionLabelStyle}>Participants</div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Student *</label>
            <div style={{ position: "relative" }}>
              <User
                size={14}
                style={{
                  position: "absolute",
                  left: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-muted)",
                  pointerEvents: "none",
                }}
              />
              <select
                value={form.student_id}
                onChange={(e) => handleStudentChange(e.target.value)}
                required
                style={{ ...selectStyle, paddingLeft: 32 }}
              >
                <option value="">Select student</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isParent ? (
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Teacher *</label>
              <select
                value={form.teacher_id}
                onChange={(e) =>
                  setForm((f) => ({ ...f, teacher_id: e.target.value }))
                }
                required
                style={selectStyle}
              >
                <option value="">Select teacher</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Teacher</label>
              <input
                type="text"
                value={user?.name ?? "You (teacher)"}
                disabled
                style={{
                  ...inputStyle,
                  background: "var(--bg-tertiary)",
                  cursor: "not-allowed",
                  opacity: 0.7,
                }}
              />
            </div>
          )}
        </div>

        {availability && !loadingAvailability && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 12px",
              borderRadius: 7,
              background:
                availability.used >= availability.limit
                  ? "var(--danger-light)"
                  : "rgba(24,128,56,0.08)",
              border: `1px solid ${
                availability.used >= availability.limit
                  ? "rgba(217,48,37,0.2)"
                  : "rgba(24,128,56,0.2)"
              }`,
              fontSize: 12,
              color:
                availability.used >= availability.limit
                  ? "var(--danger)"
                  : "var(--success)",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Info size={13} />
            Sessions used: {availability.used} / {availability.limit}
            {availability.used >= availability.limit && " — limit reached"}
          </div>
        )}
      </div>

      {/* Section: Session Details */}
      <div style={sectionStyle}>
        <div style={sectionLabelStyle}>Session Details</div>
        <div className="form-row" style={{ marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Subject *</label>
            <select
              value={form.subject}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  subject: e.target.value,
                  key_stage: "",
                  title: "",
                }))
              }
              required
              style={selectStyle}
            >
              <option value="">Select subject</option>
              {kbSubjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Key Stage / Year Group *</label>
            <select
              value={form.key_stage}
              onChange={(e) =>
                setForm((f) => ({ ...f, key_stage: e.target.value }))
              }
              style={selectStyle}
            >
              <option value="">Select key stage</option>
              {kbStages.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Session Type</label>
            <select
              value={form.session_type}
              onChange={(e) =>
                setForm((f) => ({ ...f, session_type: e.target.value }))
              }
              style={selectStyle}
            >
              {SESSION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Session Title *</label>
          <input
            type="text"
            placeholder="e.g. Cell Structure Revision"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
            style={inputStyle}
          />
        </div>

        {/* Topics / Units from knowledge base */}
        {kbUnits.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>
              Topics / Units to Cover ({selectedUnits.length} selected)
            </label>
            <div
              style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}
            >
              {kbUnits.map((unit) => {
                const sel = selectedUnits.includes(unit.unit_name);
                return (
                  <button
                    key={unit.id}
                    type="button"
                    onClick={() => toggleUnit(unit.unit_name)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 16,
                      fontSize: 12,
                      fontWeight: 500,
                      border: sel
                        ? "1.5px solid var(--accent)"
                        : "1px solid var(--border)",
                      background: sel ? "var(--accent)" : "var(--bg-secondary)",
                      color: sel ? "white" : "var(--text-primary)",
                      cursor: "pointer",
                      transition: "all 0.15s",
                      fontFamily: "inherit",
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
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
            No KB documents for {form.subject} {form.key_stage} — AI will use
            general knowledge.
          </p>
        )}
      </div>

      {/* Section: Schedule */}
      <div style={sectionStyle}>
        <div style={sectionLabelStyle}>Schedule</div>
        <div className="form-row" style={{ marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={labelStyle}>Date *</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              required
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={labelStyle}>Time *</label>
            <input
              type="time"
              value={form.time}
              onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
              required
              style={inputStyle}
            />
          </div>
          {isTeacher && (
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={labelStyle}>Payment amount (£)</label>
              <input
                type="number"
                placeholder="e.g. 25.00"
                value={form.payment_amount}
                onChange={(e) =>
                  setForm((f) => ({ ...f, payment_amount: e.target.value }))
                }
                min="0"
                step="0.01"
                style={inputStyle}
              />
            </div>
          )}
        </div>

        {/* Duration radio buttons */}
        <div>
          <label style={labelStyle}>Duration</label>
          <div
            style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}
          >
            {DURATIONS.map((d) => {
              const selected = form.duration_minutes === d.value;
              return (
                <label
                  key={d.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 16px",
                    borderRadius: 8,
                    border: selected
                      ? "2px solid var(--accent)"
                      : "1px solid var(--border)",
                    background: selected
                      ? "var(--accent-light)"
                      : "var(--bg-secondary)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                    fontSize: 13,
                    fontWeight: selected ? 700 : 500,
                    color: selected ? "var(--accent)" : "var(--text-primary)",
                  }}
                >
                  <input
                    type="radio"
                    name="duration"
                    value={d.value}
                    checked={selected}
                    onChange={() =>
                      setForm((f) => ({ ...f, duration_minutes: d.value }))
                    }
                    style={{ display: "none" }}
                  />
                  <Clock size={13} />
                  {d.label}
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* Section: Additional Settings */}
      <div style={sectionStyle}>
        <div style={sectionLabelStyle}>Additional Settings</div>

        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              marginBottom: 8,
            }}
          >
            <input
              type="checkbox"
              checked={form.require_passcode}
              onChange={(e) =>
                setForm((f) => ({ ...f, require_passcode: e.target.checked }))
              }
              style={{
                width: 15,
                height: 15,
                accentColor: "var(--accent)",
                cursor: "pointer",
              }}
            />
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              Require passcode to join
            </span>
          </label>
          {form.require_passcode && (
            <input
              type="text"
              placeholder="e.g. ABC123"
              value={form.passcode}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  passcode: e.target.value.toUpperCase(),
                }))
              }
              maxLength={16}
              style={{
                ...inputStyle,
                letterSpacing: 3,
                width: 200,
                fontWeight: 700,
              }}
            />
          )}
        </div>

        <div>
          <label style={labelStyle}>Notes for tutor (optional)</label>
          <textarea
            placeholder="Any context, key points, or specific areas to focus on..."
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            rows={3}
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--text-primary)",
              fontSize: 13,
              resize: "vertical",
              fontFamily: "inherit",
              lineHeight: 1.5,
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>

      {/* Errors & submit */}
      {error && (
        <div
          style={{
            padding: "10px 14px",
            background: "var(--danger-light)",
            border: "1px solid rgba(217,48,37,0.2)",
            borderRadius: "var(--radius)",
            color: "var(--danger)",
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          style={{
            padding: "10px 14px",
            background: "rgba(24,128,56,0.08)",
            border: "1px solid rgba(24,128,56,0.2)",
            borderRadius: "var(--radius)",
            color: "var(--success)",
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          {success}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
        <button
          type="submit"
          className="btn-primary"
          disabled={submitting}
          style={{ minWidth: 160 }}
        >
          <Calendar size={14} />
          {submitting ? "Booking…" : "Confirm & Book Session"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => navigate("/appointments")}
        >
          Cancel
        </button>
      </div>
    </form>
  );

  // ── Parent: right-side Session Summary panel ─────────────────────────
  const summaryPanel = isParent && (
    <div
      style={{
        width: 300,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        alignSelf: "flex-start",
        position: "sticky",
        top: 24,
      }}
    >
      {/* Session Summary card */}
      <div style={panelStyle}>
        <div style={panelHeaderStyle}>
          <Calendar size={15} style={{ color: "var(--accent)" }} />
          <span>Session Summary</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(
            [
              { label: "Student", value: selectedStudent?.name },
              { label: "Teacher", value: selectedTeacher?.name },
              { label: "Subject", value: form.subject || undefined },
              { label: "Key Stage", value: form.key_stage || undefined },
              { label: "Session Type", value: form.session_type || undefined },
              {
                label: "Topics",
                value:
                  selectedUnits.length > 0
                    ? selectedUnits.join(", ")
                    : undefined,
              },
              {
                label: "Date & Time",
                value: formatDateTime() ?? undefined,
              },
              {
                label: "Duration",
                value: form.duration_minutes
                  ? `${form.duration_minutes} minutes`
                  : undefined,
              },
              {
                label: "Passcode",
                value:
                  form.require_passcode && form.passcode
                    ? form.passcode
                    : undefined,
              },
            ] as Array<{ label: string; value: string | undefined }>
          ).map(({ label, value }) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                fontSize: 13,
              }}
            >
              <span style={{ color: "var(--text-secondary)", flexShrink: 0 }}>
                {label}
              </span>
              <span
                style={{
                  fontWeight: 600,
                  color: value ? "var(--text-primary)" : "var(--text-muted)",
                  textAlign: "right",
                  maxWidth: 160,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {value ?? "—"}
              </span>
            </div>
          ))}
        </div>
        {!summaryComplete && (
          <p
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              marginTop: 10,
              lineHeight: 1.5,
            }}
          >
            Fill in the form to see your session summary.
          </p>
        )}
      </div>

      {/* What happens next */}
      <div style={panelStyle}>
        <div style={panelHeaderStyle}>
          <CheckCircle size={15} style={{ color: "var(--success)" }} />
          <span>What happens next?</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            "Session is created and confirmed",
            "Student sees it in their dashboard",
            "AI tutor prepares for the session",
            "Join the session at the scheduled time",
          ].map((step) => (
            <div
              key={step}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              <CheckCircle
                size={13}
                style={{
                  color: "var(--success)",
                  flexShrink: 0,
                  marginTop: 1,
                }}
              />
              <span>{step}</span>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 12,
            padding: "8px 10px",
            background: "rgba(26,115,232,0.06)",
            border: "1px solid rgba(26,115,232,0.15)",
            borderRadius: 7,
            fontSize: 11,
            color: "var(--accent)",
            display: "flex",
            gap: 6,
            alignItems: "flex-start",
          }}
        >
          <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            You can reschedule or cancel up to 2 hours before the session.
          </span>
        </div>
      </div>

      {/* Availability progress bar */}
      {availability && (
        <div style={panelStyle}>
          <div style={panelHeaderStyle}>
            <BookOpen size={15} style={{ color: "var(--accent)" }} />
            <span>Session Availability</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              marginBottom: 8,
            }}
          >
            <span style={{ color: "var(--text-secondary)" }}>
              Sessions used
            </span>
            <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>
              {availability.used} / {availability.limit}
            </span>
          </div>
          <div
            style={{
              height: 6,
              background: "var(--bg-tertiary)",
              borderRadius: 999,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.min(
                  100,
                  (availability.used / availability.limit) * 100
                )}%`,
                background:
                  availability.used >= availability.limit
                    ? "var(--danger)"
                    : "var(--accent)",
                borderRadius: 999,
                transition: "width 0.3s",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content">
          {/* Page header */}
          <div className="dashboard-page-header" style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                onClick={() => navigate("/appointments")}
                style={{
                  background: "none",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  padding: "6px 10px",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "inherit",
                }}
              >
                <ArrowLeft size={14} /> Back
              </button>
              <div>
                <h1 style={{ margin: 0 }}>Book New Session</h1>
                <p
                  style={{
                    margin: "2px 0 0",
                    fontSize: 13,
                    color: "var(--text-secondary)",
                  }}
                >
                  {isParent
                    ? "Schedule an AI tutoring session for your child."
                    : "Schedule a session with one of your students."}
                </p>
              </div>
            </div>
          </div>

          {/* Content: form + optional summary panel */}
          <div
            style={{ display: "flex", gap: 24, alignItems: "flex-start" }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>{formContent}</div>
            {summaryPanel}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Style helpers (module-level, outside component) ───────────────────────────

const sectionStyle: React.CSSProperties = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: "18px 20px",
  marginBottom: 14,
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.6px",
  marginBottom: 14,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--text-secondary)",
  marginBottom: 5,
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  background: "var(--bg-primary)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text-primary)",
  fontSize: 13,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

const panelStyle: React.CSSProperties = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: "16px 18px",
};

const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  fontSize: 13,
  fontWeight: 700,
  color: "var(--text-primary)",
  marginBottom: 14,
};
