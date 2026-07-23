import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BlockMath } from "react-katex";
import "katex/dist/katex.min.css";
import type { InteractivePuzzleProps } from "./types";

/**
 * A maths problem — shown as crisp LaTeX, or a generated image for loose visual concepts.
 *
 * The equation now sits on a bold card that pops in, and — when the server supplies options —
 * the student TAPS one of four colourful answer bubbles instead of typing into a bare box.
 * That's the friendlier path for younger children (the ask), and it's marked exactly the same
 * way. If there are no options, it falls back to a nicely styled text input for older students.
 *
 * This puzzle rides a DARK background (mesh / bubbles), so everything here is light-on-dark.
 */

const BUBBLE_COLOURS = ["#2563eb", "#16a34a", "#f97316", "#a855f7", "#ec4899", "#0891b2"];

export default function MathPuzzle({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const mode = (payload.params.mode as string) || "latex";
  const latex = (payload.params.latex as string) || "";
  const image = (payload.params.image as string) || "";
  const options = (payload.params.options as string[]) || [];

  const [val, setVal] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  const hasChoices = options.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22, width: "100%", padding: "6px 12px 0" }}>
      {/* The problem card */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 22 }}
        // Full width so the card can use the panel; without this the flex item shrink-wraps
        // and forces the formula to wrap even with a wide panel available.
        style={{ width: "100%", display: "flex", justifyContent: "center" }}
      >
        {mode === "image" && image ? (
          <img
            src={image}
            alt="maths problem"
            // Was capped at 300x210 — a maths diagram the student must READ (side lengths,
            // angle marks) rendered as a thumbnail. The Learn panel is ~70% of the screen.
            style={{ width: "100%", maxWidth: 620, maxHeight: "min(46vh, 420px)", objectFit: "contain", borderRadius: 16, background: "#fff", padding: 10 }}
          />
        ) : latex ? (
          <>
            {/* ONE LINE. KaTeX's display wrapper is a block that wraps at spaces, so a formula
                like "A = πr², r = 6 cm" broke into four stacked lines inside a narrow card and
                read as four separate facts. nowrap keeps it as the single statement it is; the
                card stretches to the panel instead of shrink-wrapping the text. */}
            <style>{`
              .pz-math-line .katex-display { margin: 0 !important; }
              .pz-math-line .katex-display > .katex { white-space: nowrap !important; }
              .pz-math-line .katex { white-space: nowrap !important; }
            `}</style>
            <div
              className="pz-math-line"
              style={{
                // The equation IS the question — scale it with the panel, but keep it on one
                // line: the ceiling is lower than before because a wrapped formula is worse
                // than a slightly smaller one.
                fontSize: "clamp(24px, 3.4vw, 42px)", padding: "24px 34px", borderRadius: 18,
                color: "#0f172a",
                background: "rgba(255,255,255,0.96)",
                boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
                border: "1px solid rgba(255,255,255,0.6)",
                width: "100%", maxWidth: 900,
                overflowX: "auto", textAlign: "center",
              }}
            >
              {/* LAST LINE OF DEFENCE. The server repairs the common breakages, but if KaTeX
                  still can't parse something it renders a red error string at the student —
                  worse than plain text. Degrade to the readable form instead: strip the TeX
                  scaffolding and show the maths as words/symbols, so the question is always
                  answerable even when the typesetting fails. */}
              <BlockMath
                math={latex}
                renderError={() => (
                  <span style={{ fontFamily: "inherit" }}>
                    {latex
                      .replace(/\\[,;!:]/g, " ")
                      .replace(/\\(?:left|right|displaystyle)\b/g, "")
                      .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1/$2")
                      .replace(/\\text\s*\{([^{}]*)\}/g, "$1")
                      .replace(/\\times/g, "×").replace(/\\div/g, "÷")
                      .replace(/\\pi/g, "π").replace(/\\theta/g, "θ")
                      .replace(/\\geq/g, "≥").replace(/\\leq/g, "≤").replace(/\\neq/g, "≠")
                      .replace(/\\approx/g, "≈").replace(/\\pm/g, "±")
                      .replace(/\\rightarrow/g, "→").replace(/\\%/g, "%")
                      .replace(/\^2/g, "²").replace(/\^3/g, "³")
                      .replace(/\\[a-zA-Z]+/g, "")
                      .replace(/[{}]/g, "")
                      .replace(/\s{2,}/g, " ")
                      .trim()}
                  </span>
                )}
              />
            </div>
          </>
        ) : null}
      </motion.div>

      {hasChoices ? (
        <>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr",
            gap: 14, width: "100%", maxWidth: 460,
          }}>
            <AnimatePresence>
              {options.map((opt, i) => {
                const chosen = picked === opt;
                const colour = BUBBLE_COLOURS[i % BUBBLE_COLOURS.length];
                return (
                  <motion.button
                    key={opt}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 420, damping: 22, delay: i * 0.06 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => !disabled && setPicked(opt)}
                    disabled={disabled}
                    style={{
                      minHeight: 66, borderRadius: 16, cursor: disabled ? "default" : "pointer",
                      fontFamily: "inherit", fontSize: 22, fontWeight: 800,
                      color: chosen ? "#fff" : colour,
                      background: chosen ? colour : "rgba(255,255,255,0.96)",
                      border: `3px solid ${colour}`,
                      boxShadow: chosen ? `0 6px 18px ${colour}88` : "0 4px 0 rgba(0,0,0,0.18)",
                      transition: "background .15s, color .15s, box-shadow .15s",
                    }}
                  >
                    {opt}
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>

          <CheckButton onClick={() => picked && onSubmit(picked)} disabled={disabled || !picked} />
        </>
      ) : (
        <>
          <input
            style={{
              width: 240, padding: "14px 16px", borderRadius: 14, fontSize: 22, fontWeight: 800,
              textAlign: "center", fontFamily: "inherit", color: "#0f172a",
              background: "rgba(255,255,255,0.96)", border: "3px solid rgba(255,255,255,0.7)",
              outlineColor: "#2563eb",
            }}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && val.trim()) onSubmit(val.trim()); }}
            placeholder="Your answer"
            autoFocus
            disabled={disabled}
          />
          <CheckButton onClick={() => onSubmit(val.trim())} disabled={disabled || !val.trim()} />
        </>
      )}
    </div>
  );
}

function CheckButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 54, padding: "0 44px", fontSize: 19, fontWeight: 800, fontFamily: "inherit",
        color: "#fff", border: "none", borderRadius: 14,
        background: disabled ? "rgba(148,163,184,0.6)" : "#16a34a",
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled ? "none" : "0 4px 0 #15803d",
      }}
    >
      Check
    </button>
  );
}
