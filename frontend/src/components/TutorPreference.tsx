import { useEffect, useState } from "react";
import { curriculumApi, type Tutor } from "../services/api";
import TutorPickerPills from "./TutorPickerPills";

/**
 * "Choose your AI tutor voice" card.
 *
 * The selection is remembered in localStorage (`preferredTutor`) and is used as
 * the default tutor when booking a lesson — both LessonSetupPage (student) and
 * BookSessionPage (parent/teacher) read the same key, so picking a tutor here
 * pre-selects it on the next booking. It never changes an already-booked lesson.
 */
export default function TutorPreference() {
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [tutorId, setTutorId] = useState<string>(() => localStorage.getItem("preferredTutor") || "aria");

  useEffect(() => {
    curriculumApi.getTutors()
      .then((res) => {
        setTutors(res.tutors ?? []);
        // Adopt the server default only if the user hasn't chosen one yet.
        if (!localStorage.getItem("preferredTutor") && res.default) setTutorId(res.default);
      })
      .catch(() => setTutors([]));
  }, []);

  useEffect(() => {
    localStorage.setItem("preferredTutor", tutorId);
  }, [tutorId]);

  if (tutors.length === 0) return null;

  return (
    <div
      style={{
        background: "var(--bg-primary, #fff)",
        border: "1px solid var(--border-color, #e2e8f0)",
        borderRadius: 14,
        padding: "16px 18px",
        marginBottom: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 20 }}>🎙️</span>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary, #0f172a)" }}>
            Your AI tutor
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted, #94a3b8)" }}>
            Pick the voice used for your lessons — remembered for your next booking.
          </div>
        </div>
      </div>

      <TutorPickerPills tutors={tutors} value={tutorId} onChange={setTutorId} />
    </div>
  );
}
