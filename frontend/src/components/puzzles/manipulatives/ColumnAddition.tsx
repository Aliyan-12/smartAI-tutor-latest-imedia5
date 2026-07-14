import { useRef, useState } from "react";
import { motion } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { BAND, CheckBar, Stage } from "./Shell";
import { playTapSound } from "../../../lib/sounds";

const DIGIT_COLOURS = ["#2563eb", "#16a34a", "#f97316", "#ec4899", "#7c3aed", "#0891b2", "#dc2626"];

/**
 * Column addition, laid out the way it's taught on paper: digits right-aligned in columns,
 * each place value in its own colour so the columns are visually obvious, and one answer box
 * per column. Typing a digit jumps to the next box; backspace steps back.
 */
export default function ColumnAddition({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const addends = (payload.params.addends as number[]) || [];
  const width = (payload.params.width as number) ?? 4;

  const [digits, setDigits] = useState<string[]>(() => Array(width).fill(""));
  const boxes = useRef<Array<HTMLInputElement | null>>([]);

  const maxLen = Math.max(width, ...addends.map((n) => String(n).length));

  const setDigit = (i: number, raw: string) => {
    if (disabled) return;
    const d = raw.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = d;
      return next;
    });
    if (d) {
      playTapSound();
      boxes.current[i + 1]?.focus();
    }
  };

  const onKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) boxes.current[i - 1]?.focus();
  };

  // Right-align every number into a fixed grid of columns, the way it's written by hand.
  const cell = (ch: string, colour: string, key: string) => (
    <div
      key={key}
      style={{
        width: 54, height: 62, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 34, fontWeight: 800, color: colour, fontVariantNumeric: "tabular-nums",
      }}
    >
      {ch}
    </div>
  );

  const answered = digits.filter(Boolean).length;

  return (
    <>
      <Stage>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
          <div style={{ fontSize: 34, fontWeight: 800, color: BAND.muted, paddingBottom: 76, width: 34 }}>+</div>

          <div>
            {addends.map((n, r) => {
              const s = String(n).padStart(maxLen, " ");
              return (
                <div key={r} style={{ display: "flex" }}>
                  {s.split("").map((ch, c) =>
                    cell(ch === " " ? "" : ch, DIGIT_COLOURS[(maxLen - c - 1) % DIGIT_COLOURS.length], `${r}-${c}`),
                  )}
                </div>
              );
            })}

            <div style={{ height: 3, background: BAND.ink, margin: "6px 0 10px", borderRadius: 2 }} />

            {/* Answer boxes — one per column, right-aligned under the sum. */}
            <div style={{ display: "flex" }}>
              {Array.from({ length: maxLen - width }, (_, i) => (
                <div key={`pad-${i}`} style={{ width: 54 }} />
              ))}
              {digits.map((d, i) => (
                <motion.input
                  key={i}
                  ref={(el) => { boxes.current[i] = el; }}
                  value={d}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => onKey(i, e)}
                  disabled={disabled}
                  inputMode="numeric"
                  aria-label={`Answer digit ${i + 1}`}
                  animate={{ scale: d ? 1 : 0.97 }}
                  style={{
                    width: 48, height: 60, margin: "0 3px",
                    textAlign: "center", fontSize: 32, fontWeight: 800,
                    color: DIGIT_COLOURS[(width - i - 1) % DIGIT_COLOURS.length],
                    border: `2px solid ${d ? BAND.green : BAND.line}`,
                    borderRadius: 10, background: "#fff", fontFamily: "inherit",
                    outlineColor: BAND.blue, fontVariantNumeric: "tabular-nums",
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </Stage>

      <CheckBar
        onCheck={() => onSubmit(digits.join(""))}
        disabled={disabled || answered < width}
        hint={answered < width ? `${width - answered} to go` : undefined}
      />
    </>
  );
}
