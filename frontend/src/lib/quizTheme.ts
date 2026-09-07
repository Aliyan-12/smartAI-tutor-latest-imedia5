// Age-appropriate theme for quiz + practice question cards, driven by Key Stage.
//  - KS1–KS2 (Y1–Y6): bright, playful (sky/grass, encouraging).
//  - KS3–KS5 (Y7 → GCSE / A-Level): focused, "cosmic" dark.
// Used by both the in-lesson Quiz tab and the Practice-tab MCQ so they look identical.

export interface QuizTheme {
  isJunior: boolean;
  wrap: string;      // full-panel background
  qBox: string;      // question box background
  qBoxBorder: string;
  qText: string;     // question / option text colour
  chipBg: string;
  chipColor: string;
  track: string;     // progress-track background
  accent: string;    // primary accent (buttons, progress fill)
  cardBg: string;    // option card background (unselected)
  cardBorder: string;
}

// Option accent colours (A blue, B green, C orange, D purple) — shared by both variants.
export const QUIZ_OPT_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#7c3aed"];

export function isJuniorStage(keyStage?: string): boolean {
  return ["KS1", "KS2"].includes((keyStage || "").toUpperCase().trim());
}

export function getQuizTheme(keyStage?: string): QuizTheme {
  const isJunior = isJuniorStage(keyStage);
  return isJunior
    ? {
        isJunior,
        wrap: "linear-gradient(160deg,#dbeafe 0%,#c7f9e5 55%,#bbf7d0 100%)",
        qBox: "#ffffff", qBoxBorder: "1px solid #e2e8f0",
        qText: "#0f172a",
        chipBg: "#fef9c3", chipColor: "#a16207",
        track: "#e2e8f0", accent: "#2563eb",
        cardBg: "#ffffff", cardBorder: "#e2e8f0",
      }
    : {
        isJunior,
        wrap: "linear-gradient(160deg,#0b1220 0%,#0f172a 55%,#1e293b 100%)",
        qBox: "rgba(255,255,255,0.06)", qBoxBorder: "1px solid rgba(255,255,255,0.10)",
        qText: "#f8fafc",
        chipBg: "rgba(255,255,255,0.10)", chipColor: "#c7d2fe",
        track: "rgba(255,255,255,0.12)", accent: "#60a5fa",
        cardBg: "rgba(255,255,255,0.05)", cardBorder: "rgba(255,255,255,0.14)",
      };
}
