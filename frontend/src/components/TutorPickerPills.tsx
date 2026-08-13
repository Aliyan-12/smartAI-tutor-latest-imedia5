import { useState } from "react";
import { Volume2 } from "lucide-react";
import { type Tutor } from "../services/api";
import { playTutorPreview } from "../lib/tutorPreview";

/**
 * Tutor voice picker: a row of selectable pills, each with a speaker button on
 * the right that plays a short spoken sample in that tutor's voice so the booker
 * can hear it before confirming. Used by the student/parent/teacher booking forms
 * and the dashboard tutor-preference card.
 */
export default function TutorPickerPills({
  tutors,
  value,
  onChange,
}: {
  tutors: Tutor[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [playingId, setPlayingId] = useState<string | null>(null);

  const preview = (id: string) => {
    setPlayingId(id);
    playTutorPreview(id, () => setPlayingId((p) => (p === id ? null : p)));
  };

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {tutors.map((t) => {
        const sel = value === t.id;
        const playing = playingId === t.id;
        return (
          <div
            key={t.id}
            style={{
              display: "flex", alignItems: "stretch",
              borderRadius: 999, overflow: "hidden",
              border: `2px solid ${sel ? "#1a73e8" : "var(--border-color, #e2e8f0)"}`,
              background: sel ? "#eff6ff" : "var(--bg-secondary, #fff)",
              boxShadow: sel ? "0 2px 8px rgba(26,115,232,0.12)" : "none",
              transition: "all 0.15s",
            }}
          >
            <button
              type="button"
              onClick={() => onChange(t.id)}
              title={t.blurb}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 12px 8px 14px", border: "none", background: "transparent",
                fontFamily: "inherit", cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 18 }}>{t.emoji}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: sel ? "#1a73e8" : "var(--text-primary, #0f172a)" }}>
                {t.name}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-muted, #94a3b8)" }}>
                {t.gender === "male" ? "♂" : "♀"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => preview(t.id)}
              title={`Hear ${t.name}'s voice`}
              aria-label={`Hear ${t.name}'s voice`}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: "0 11px", border: "none",
                borderLeft: `1px solid ${sel ? "rgba(26,115,232,0.25)" : "var(--border-color, #e2e8f0)"}`,
                background: playing ? "rgba(26,115,232,0.12)" : "transparent",
                cursor: "pointer", color: playing ? "#1a73e8" : "var(--text-muted, #64748b)",
                transition: "all 0.15s",
              }}
            >
              <Volume2 size={15} style={{ animation: playing ? "tutorPulse 1s ease-in-out infinite" : "none" }} />
            </button>
          </div>
        );
      })}
      <style>{`@keyframes tutorPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}
