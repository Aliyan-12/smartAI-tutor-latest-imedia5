import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { BAND, CheckBar, Stage } from "./Shell";
import { playTapSound } from "../../../lib/sounds";

const BUBBLE_COLOURS = ["#ec4899", "#f97316", "#22c55e", "#3b82f6", "#a855f7", "#eab308"];

/**
 * KS1 counting. Tap each object to mark it — it ticks and jiggles — then type how many there
 * were. The tap-to-mark is the scaffold: a four-year-old loses track counting by eye, so we
 * let them keep their place, the way they'd use a finger on paper.
 */
export default function CountingBubbles({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const count = (payload.params.count as number) ?? 5;
  const item = (payload.params.item as string) ?? "bubbles";

  const [tapped, setTapped] = useState<Set<number>>(new Set());
  const [answer, setAnswer] = useState("");

  // Scatter them, but stably — re-randomising on every render would make them jump about.
  const spots = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        colour: BUBBLE_COLOURS[i % BUBBLE_COLOURS.length],
        wobble: ((i * 37) % 14) - 7,
      })),
    [count],
  );

  const tap = (i: number) => {
    if (disabled) return;
    playTapSound();
    setTapped((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  return (
    <>
      <Stage style={{ gap: 22 }}>
        <div
          style={{
            display: "flex", flexWrap: "wrap", gap: 18,
            alignItems: "center", justifyContent: "center",
            maxWidth: 700, padding: 20,
            background: "#f8fafc", borderRadius: 20, border: `2px dashed ${BAND.line}`,
          }}
        >
          {spots.map((s, i) => (
            <motion.button
              key={i}
              onClick={() => tap(i)}
              disabled={disabled}
              aria-label={`${item} ${i + 1}`}
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: s.wobble }}
              transition={{ type: "spring", stiffness: 400, damping: 18, delay: i * 0.045 }}
              whileTap={{ scale: 0.86 }}
              style={{
                width: 66, height: 66, borderRadius: "50%",
                background: s.colour,
                border: tapped.has(i) ? `4px solid ${BAND.ink}` : "4px solid transparent",
                cursor: disabled ? "default" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 26, color: "#fff", fontWeight: 800,
                boxShadow: "inset 0 -5px 0 rgba(0,0,0,0.15)",
              }}
            >
              {tapped.has(i) ? "✓" : ""}
            </motion.button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 24, fontWeight: 800, color: BAND.ink }}>How many?</span>
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value.replace(/\D/g, "").slice(0, 2))}
            disabled={disabled}
            inputMode="numeric"
            aria-label="How many"
            placeholder="?"
            style={{
              width: 100, height: 68, textAlign: "center", fontSize: 34, fontWeight: 800,
              border: `3px solid ${answer ? BAND.green : BAND.line}`, borderRadius: 14,
              fontFamily: "inherit", color: BAND.ink, background: "#fff",
            }}
          />
        </div>
      </Stage>

      <CheckBar
        onCheck={() => onSubmit(parseInt(answer, 10))}
        disabled={disabled || !answer}
        hint={tapped.size > 0 ? `You've marked ${tapped.size}` : "Tap each one to keep count"}
      />
    </>
  );
}
