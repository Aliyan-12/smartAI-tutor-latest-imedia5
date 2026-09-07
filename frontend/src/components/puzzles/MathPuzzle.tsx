import { useEffect, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { InteractivePuzzleProps } from "./types";
import { emitSessionEvent } from "../../lib/sessionBus";
import { getQuizTheme, QUIZ_OPT_COLORS } from "../../lib/quizTheme";
import { normalizeMathText } from "../../lib/mathText";

/**
 * A maths question — the student TAPS one of the A/B/C/D answer cards (or types an answer).
 *
 * It fills the whole Practice panel with an age-appropriate theme (KS1–KS2 bright & playful,
 * KS3 → GCSE focused/cosmic) so it reads like a proper quiz card, not a bare form. Correctness
 * is decided server-side, so this only collects the answer.
 */
const LETTERS = ["A", "B", "C", "D", "E", "F"];

export default function MathPuzzle({ payload, onSubmit, disabled, keyStage }: InteractivePuzzleProps) {
  const mode = (payload.params.mode as string) || "latex";
  const image = (payload.params.image as string) || "";
  const latex = (payload.params.latex as string) || "";
  const options = (payload.params.options as string[]) || [];
  const hasChoices = options.length > 0;

  const [val, setVal] = useState("");
  const [pickedIdx, setPickedIdx] = useState<number | null>(null);
  const [hintOpen, setHintOpen] = useState(false);

  const t = getQuizTheme(keyStage);
  const isJunior = t.isJunior;

  // VALIDATE → the server repairs broken LaTeX; if KaTeX still can't parse it, bounce a
  // `latex_error` so the AI re-emits a corrected question (reported once per distinct latex).
  const reportedRef = useRef("");
  useEffect(() => {
    if (!latex || mode === "image") return;
    try {
      katex.renderToString(latex, { throwOnError: true, displayMode: true });
    } catch (e) {
      if (reportedRef.current !== latex) {
        reportedRef.current = latex;
        emitSessionEvent("latex_error", {
          latex, error: String((e as Error)?.message || e || "KaTeX parse error"),
          prompt: payload.prompt || "",
        });
      }
    }
  }, [latex, mode, payload.prompt]);

  // The question reads as clean text (Unicode maths, never raw "$10^{-1}$").
  const questionText = normalizeMathText(payload.prompt || latex || "");

  const submitChoice = () => { if (pickedIdx !== null && !disabled) onSubmit(options[pickedIdx]); };
  const submitTyped = () => { if (val.trim() && !disabled) onSubmit(val.trim()); };
  const skip = () => { if (!disabled) emitSessionEvent("user_message", { text: "Can we skip this question and move on, please?" }); };

  return (
    <div style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, width: "100%", overflow: "auto", background: "transparent" }}>
      {/* Content sits on the shared themed panel + decorations provided by PuzzlePlayer. */}
      <div style={{ position: "relative", zIndex: 1, minHeight: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "center", gap: 18, padding: "22px clamp(16px, 6vw, 90px)" }}>
        {/* Question box */}
        <div style={{ background: t.qBox, border: t.qBoxBorder, borderRadius: 16, padding: "26px 24px", textAlign: "center", boxShadow: isJunior ? "0 4px 14px rgba(0,0,0,0.06)" : "none" }}>
          {mode === "image" && image ? (
            <img src={image} alt="maths problem" style={{ width: "100%", maxWidth: 560, maxHeight: "min(38vh, 360px)", objectFit: "contain", borderRadius: 12, background: "#fff", padding: 8 }} />
          ) : (
            <span style={{ fontSize: "clamp(20px, 2.6vw, 30px)", fontWeight: 700, color: t.qText, lineHeight: 1.35 }}>{questionText}</span>
          )}
        </div>

        {/* Options (A/B/C/D) or a typed answer */}
        {hasChoices ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 760, width: "100%", margin: "0 auto" }}>
            {options.map((opt, i) => {
              const oc = QUIZ_OPT_COLORS[i % QUIZ_OPT_COLORS.length];
              const picked = pickedIdx === i;
              return (
                <button
                  key={`${opt}-${i}`}
                  disabled={disabled}
                  onClick={() => !disabled && setPickedIdx(i)}
                  style={{
                    display: "flex", alignItems: "center", gap: 14, padding: "15px 18px",
                    border: `2px solid ${picked ? oc : t.cardBorder}`,
                    background: picked ? (isJunior ? `${oc}14` : "rgba(255,255,255,0.12)") : t.cardBg,
                    borderRadius: 14, cursor: disabled ? "default" : "pointer", textAlign: "left",
                    color: t.qText, fontFamily: "inherit", transition: "border-color .15s, background .15s",
                    boxShadow: picked ? `0 4px 14px ${oc}55` : "none",
                  }}
                >
                  <span style={{ width: 36, height: 36, borderRadius: "50%", background: oc, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, flexShrink: 0 }}>{LETTERS[i] ?? i + 1}</span>
                  <span style={{ flex: 1, fontSize: 20, fontWeight: 700 }}>{opt}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitTyped(); }}
            placeholder="Type your answer"
            autoFocus
            disabled={disabled}
            style={{ alignSelf: "center", width: "min(320px, 90%)", padding: "14px 16px", borderRadius: 14, fontSize: 20, fontWeight: 700, textAlign: "center", fontFamily: "inherit", color: t.qText, background: t.qBox, border: `2px solid ${t.cardBorder}`, outlineColor: t.accent }}
          />
        )}

        {/* Check Answer */}
        <button
          onClick={hasChoices ? submitChoice : submitTyped}
          disabled={disabled || (hasChoices ? pickedIdx === null : !val.trim())}
          style={{
            alignSelf: "center", minWidth: "min(380px, 90%)", padding: "14px 26px", borderRadius: 12,
            fontSize: 15.5, fontWeight: 800, fontFamily: "inherit", color: "#fff", border: "none",
            background: (disabled || (hasChoices ? pickedIdx === null : !val.trim())) ? "rgba(148,163,184,0.6)" : `linear-gradient(135deg, ${t.accent}, #1d4ed8)`,
            cursor: (disabled || (hasChoices ? pickedIdx === null : !val.trim())) ? "not-allowed" : "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          {disabled ? "Checking…" : "Check Answer →"}
        </button>

        {/* Hint tip */}
        {hintOpen && (
          <div style={{ alignSelf: "center", maxWidth: 560, padding: "10px 14px", borderRadius: 12, background: isJunior ? "#fffbeb" : "rgba(250,204,21,0.12)", border: "1px solid rgba(234,179,8,0.35)", fontSize: 12.5, color: t.qText, lineHeight: 1.5, textAlign: "center" }}>
            💡 Tip: rule out the options you know are wrong first, then pick the best one. Take your time!
          </div>
        )}

        {/* Need a hint? / Skip question */}
        {!disabled && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 760, width: "100%", margin: "0 auto" }}>
            <button onClick={() => setHintOpen((v) => !v)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: t.accent, display: "inline-flex", alignItems: "center", gap: 5 }}>💡 Need a hint?</button>
            <button onClick={skip} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: t.qText, opacity: 0.7, display: "inline-flex", alignItems: "center", gap: 5 }}>Skip question →</button>
          </div>
        )}
      </div>
    </div>
  );
}
