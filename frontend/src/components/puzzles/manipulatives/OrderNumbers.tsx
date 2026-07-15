import { useState } from "react";
import { motion } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { BAND, CheckBar, Stage } from "./Shell";
import { playTapSound } from "../../../lib/sounds";

/**
 * Ordering numbers, as a puzzle instead of a plain-text question.
 *
 * The tutor used to type "put these in order: 45, 12, 51" into chat and wait for a written
 * reply — impossible for a five-year-old. Now scrambled number cards appear and the child
 * TAPS them one at a time into the row of slots; tapping a placed card takes it back out.
 * The server derives the target order (smallest→biggest or the reverse) from the numbers, so
 * it can never disagree with the marking.
 */

const CARD_COLOURS = ["#3b82f6", "#ec4899", "#22c55e", "#f97316", "#a855f7"];

export default function OrderNumbers({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const shown = (payload.params.shown as number[]) || [];
  const [seq, setSeq] = useState<number[]>([]); // indices into `shown`, in tap order

  const place = (i: number) => {
    if (disabled || seq.includes(i)) return;
    playTapSound();
    setSeq((s) => [...s, i]);
  };
  const remove = (i: number) => {
    if (disabled) return;
    playTapSound();
    setSeq((s) => s.filter((x) => x !== i));
  };

  const complete = shown.length > 0 && seq.length === shown.length;

  return (
    <>
      <Stage style={{ gap: 26 }}>
        {/* the ordered row of slots */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", minHeight: 92 }}>
          {shown.map((_, slot) => {
            const idx = seq[slot];
            const filled = idx !== undefined;
            return (
              <div key={slot} style={{
                width: 84, height: 84, borderRadius: 18,
                border: `3px ${filled ? "solid" : "dashed"} ${filled ? BAND.ink : BAND.line}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                position: "relative", background: "#fff",
              }}>
                <span style={{ position: "absolute", top: 4, left: 8, fontSize: 12, fontWeight: 700, color: BAND.muted }}>
                  {slot + 1}
                </span>
                {filled ? (
                  <motion.button
                    layout
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    whileTap={{ scale: 0.92 }}
                    onClick={() => remove(idx)}
                    disabled={disabled}
                    aria-label={`remove ${shown[idx]}`}
                    style={{
                      width: 72, height: 72, borderRadius: 14, border: "none",
                      cursor: disabled ? "default" : "pointer",
                      background: CARD_COLOURS[idx % CARD_COLOURS.length], color: "#fff",
                      fontSize: 30, fontWeight: 800, fontFamily: "inherit",
                    }}
                  >
                    {shown[idx]}
                  </motion.button>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* the cards to pick from */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
          {shown.map((n, i) => {
            const used = seq.includes(i);
            const colour = CARD_COLOURS[i % CARD_COLOURS.length];
            return (
              <motion.button
                key={i}
                onClick={() => place(i)}
                disabled={disabled || used}
                whileTap={{ scale: 0.94 }}
                animate={{ opacity: used ? 0.25 : 1, y: used ? 6 : 0 }}
                aria-label={`number ${n}`}
                style={{
                  minWidth: 96, height: 96, borderRadius: 20, fontSize: 38, fontWeight: 800,
                  fontFamily: "inherit", cursor: used || disabled ? "default" : "pointer",
                  color: used ? "#94a3b8" : colour, background: "#fff",
                  border: `4px solid ${used ? BAND.line : colour}`,
                  boxShadow: used ? "none" : "0 5px 0 rgba(0,0,0,0.10)",
                }}
              >
                {n}
              </motion.button>
            );
          })}
        </div>
      </Stage>

      <CheckBar
        onCheck={() => onSubmit({ order: seq.map((i) => shown[i]) })}
        disabled={disabled || !complete}
        hint={complete ? "Ready — press Check" : "Tap the numbers in order"}
      />
    </>
  );
}
