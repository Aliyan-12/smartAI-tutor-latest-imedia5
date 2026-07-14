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
 *
 * The server varies the objects AND the arrangement per puzzle. That isn't decoration:
 *   • scatter   — genuinely have to count them
 *   • rows      — encourages counting in groups
 *   • ten_frame — the classic number-bond frame; "7 is 5 and 2, and 3 away from 10"
 * A child who only ever sees a neat row learns to read the row, not to count.
 */
export default function CountingBubbles({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const count = (payload.params.count as number) ?? 5;
  const item = (payload.params.item as string) ?? "bubbles";
  const emoji = (payload.params.emoji as string) || "";
  const layout = (payload.params.layout as string) || "scatter";

  const [tapped, setTapped] = useState<Set<number>>(new Set());
  const [answer, setAnswer] = useState("");

  // Stable per mount — re-randomising on every render would make them jump about mid-count.
  const spots = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        colour: BUBBLE_COLOURS[i % BUBBLE_COLOURS.length],
        wobble: layout === "scatter" ? ((i * 37) % 16) - 8 : 0,
        nudge: layout === "scatter" ? ((i * 53) % 18) - 9 : 0,
      })),
    [count, layout],
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

  const Bubble = ({ i }: { i: number }) => {
    const s = spots[i];
    return (
      <motion.button
        onClick={() => tap(i)}
        disabled={disabled}
        aria-label={`${item} ${i + 1}`}
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: s.wobble, y: s.nudge }}
        transition={{ type: "spring", stiffness: 400, damping: 18, delay: i * 0.04 }}
        whileTap={{ scale: 0.86 }}
        style={{
          width: 64, height: 64, borderRadius: "50%",
          background: emoji ? "transparent" : s.colour,
          border: tapped.has(i) ? `4px solid ${BAND.ink}` : "4px solid transparent",
          cursor: disabled ? "default" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: emoji ? 40 : 26, color: "#fff", fontWeight: 800,
          boxShadow: emoji ? "none" : "inset 0 -5px 0 rgba(0,0,0,0.15)",
          position: "relative",
        }}
      >
        {emoji || ""}
        {tapped.has(i) && (
          <span style={{
            position: "absolute", top: -2, right: -2, fontSize: 16,
            background: BAND.green, color: "#fff", borderRadius: "50%",
            width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            ✓
          </span>
        )}
      </motion.button>
    );
  };

  const board = () => {
    if (layout === "ten_frame") {
      // Two rows of five — the standard ten-frame. Empty cells stay visible, because seeing the
      // three gaps is how a child works out that 7 is 3 away from 10.
      return (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(5, 76px)", gridTemplateRows: "repeat(2, 76px)",
          gap: 0, border: `3px solid ${BAND.ink}`, borderRadius: 10, overflow: "hidden",
        }}>
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRight: i % 5 !== 4 ? `2px solid ${BAND.line}` : "none",
              borderBottom: i < 5 ? `2px solid ${BAND.line}` : "none",
              background: "#fff",
            }}>
              {i < count ? <Bubble i={i} /> : null}
            </div>
          ))}
        </div>
      );
    }
    if (layout === "rows") {
      return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, auto)", gap: 16, justifyContent: "center" }}>
          {Array.from({ length: count }, (_, i) => <Bubble key={i} i={i} />)}
        </div>
      );
    }
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center", justifyContent: "center", maxWidth: 640 }}>
        {Array.from({ length: count }, (_, i) => <Bubble key={i} i={i} />)}
      </div>
    );
  };

  return (
    <>
      <Stage style={{ gap: 22 }}>
        <div style={{
          padding: 22, background: "#f8fafc", borderRadius: 20,
          border: `2px dashed ${BAND.line}`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {board()}
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
