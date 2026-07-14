import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { BAND, CheckBar, Stage, Stepper } from "./Shell";
import { playTapSound } from "../../../lib/sounds";

/**
 * Multiplication as an array of dots. Grow the rows and columns, watch the rectangle of dots
 * build itself, then say how many there are. This is the activity that makes square numbers
 * obvious — 4 × 4 is literally a square on the screen.
 */
export default function DotArray({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const max = (payload.params.max as number) ?? 12;

  const [rows, setRows] = useState(1);
  const [cols, setCols] = useState(1);
  const [answer, setAnswer] = useState("");

  const bump = (which: "rows" | "cols", delta: number) => {
    if (disabled) return;
    playTapSound();
    const set = which === "rows" ? setRows : setCols;
    set((v) => Math.max(1, Math.min(max, v + delta)));
  };

  const isSquare = rows === cols && rows > 1;

  return (
    <>
      <Stage style={{ gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          {/* Rows control, alongside the array like an axis */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <Stepper sign="+" onClick={() => bump("rows", +1)} disabled={disabled || rows >= max} />
            <span style={{ fontSize: 24, fontWeight: 800, color: BAND.blue }}>{rows}</span>
            <Stepper sign="−" onClick={() => bump("rows", -1)} disabled={disabled || rows <= 1} />
            <span style={{ fontSize: 11, fontWeight: 800, color: BAND.muted, textTransform: "uppercase" }}>rows</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <motion.div
              layout
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gap: 8,
                padding: 14,
                border: `3px solid #eab308`,
                borderRadius: 12,
                background: "#0f172a",
                minWidth: 90,
                minHeight: 90,
              }}
            >
              <AnimatePresence>
                {Array.from({ length: rows * cols }, (_, i) => (
                  <motion.div
                    key={i}
                    layout
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 24, delay: (i % 12) * 0.012 }}
                    style={{
                      width: Math.max(16, Math.min(30, 300 / Math.max(rows, cols))),
                      height: Math.max(16, Math.min(30, 300 / Math.max(rows, cols))),
                      borderRadius: "50%",
                      background: "#60a5fa",
                    }}
                  />
                ))}
              </AnimatePresence>
            </motion.div>

            {/* Columns control, under the array */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Stepper sign="−" onClick={() => bump("cols", -1)} disabled={disabled || cols <= 1} />
              <span style={{ fontSize: 24, fontWeight: 800, color: BAND.blue, minWidth: 30, textAlign: "center" }}>{cols}</span>
              <Stepper sign="+" onClick={() => bump("cols", +1)} disabled={disabled || cols >= max} />
              <span style={{ fontSize: 11, fontWeight: 800, color: BAND.muted, textTransform: "uppercase", marginLeft: 4 }}>columns</span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 28, fontWeight: 800, color: BAND.ink }}>
            {rows} × {cols} =
          </span>
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value.replace(/\D/g, "").slice(0, 3))}
            disabled={disabled}
            inputMode="numeric"
            aria-label="The answer"
            placeholder="?"
            style={{
              width: 96, height: 60, textAlign: "center", fontSize: 30, fontWeight: 800,
              border: `2px solid ${answer ? BAND.green : BAND.line}`, borderRadius: 12,
              fontFamily: "inherit", color: BAND.ink, background: "#fff",
            }}
          />
          {isSquare && (
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              style={{ fontSize: 14, fontWeight: 800, color: "#d97706" }}
            >
              ⬛ a square!
            </motion.span>
          )}
        </div>
      </Stage>

      <CheckBar
        onCheck={() => onSubmit({ rows, cols, product: parseInt(answer, 10) })}
        disabled={disabled || !answer}
      />
    </>
  );
}
