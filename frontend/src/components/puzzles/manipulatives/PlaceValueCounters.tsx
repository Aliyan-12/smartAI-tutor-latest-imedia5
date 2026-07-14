import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { BAND, CheckBar, Stage, Stepper } from "./Shell";
import { playTapSound } from "../../../lib/sounds";

interface Column { place: number; label: string; colour: string }

/**
 * Place value as physical counters. Each column holds up to 9 counters; +/- adds and removes
 * them, the expanded form builds itself underneath, and the running total updates live — so
 * the child SEES that four counters in the 100s column means 400, not 4.
 */
export default function PlaceValueCounters({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const columns = (payload.params.columns as Column[]) || [];
  const maxPer = (payload.params.max_per_column as number) ?? 9;

  const [counts, setCounts] = useState<Record<string, number>>(
    () => Object.fromEntries(columns.map((c) => [String(c.place), 0])),
  );

  const bump = (place: number, delta: number) => {
    if (disabled) return;
    const key = String(place);
    setCounts((prev) => {
      const next = Math.max(0, Math.min(maxPer, (prev[key] ?? 0) + delta));
      if (next === prev[key]) return prev;
      playTapSound();
      return { ...prev, [key]: next };
    });
  };

  const total = columns.reduce((sum, c) => sum + (counts[String(c.place)] ?? 0) * c.place, 0);
  const parts = columns
    .filter((c) => (counts[String(c.place)] ?? 0) > 0)
    .map((c) => (counts[String(c.place)] ?? 0) * c.place);

  return (
    <>
      <Stage style={{ justifyContent: "flex-start", paddingTop: 4 }}>
        <div style={{ display: "flex", gap: 14, width: "100%", maxWidth: 880, flex: 1, minHeight: 0 }}>
          {columns.map((col) => {
            const n = counts[String(col.place)] ?? 0;
            return (
              <div key={col.place} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <div style={{ textAlign: "center", fontSize: 15, fontWeight: 800, color: col.colour }}>
                  {col.label}
                </div>

                {/* The tray. Counters spring in and out — the motion is what makes it feel real. */}
                <div
                  style={{
                    flex: 1,
                    minHeight: 150,
                    border: `3px solid ${col.colour}`,
                    borderRadius: 16,
                    background: "#fff",
                    padding: 10,
                    display: "flex",
                    flexWrap: "wrap",
                    alignContent: "flex-start",
                    justifyContent: "center",
                    gap: 8,
                    overflow: "hidden",
                  }}
                >
                  <AnimatePresence>
                    {Array.from({ length: n }, (_, i) => (
                      <motion.div
                        key={i}
                        layout
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 520, damping: 24 }}
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: "50%",
                          background: col.colour,
                          boxShadow: "inset 0 -3px 0 rgba(0,0,0,0.14)",
                        }}
                      />
                    ))}
                  </AnimatePresence>
                </div>

                <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                  <Stepper sign="−" colour={col.colour} onClick={() => bump(col.place, -1)} disabled={disabled || n === 0} />
                  <Stepper sign="+" colour={col.colour} onClick={() => bump(col.place, +1)} disabled={disabled || n >= maxPer} />
                </div>

                <div style={{ textAlign: "center", fontSize: 20, fontWeight: 800, color: col.colour }}>
                  {(n * col.place).toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>

        {/* Expanded form + running total — the whole point of the activity. */}
        <div style={{ textAlign: "center", flexShrink: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: BAND.muted, minHeight: 24 }}>
            {parts.length ? parts.map((p) => p.toLocaleString()).join("  +  ") : " "}
          </div>
          <motion.div
            key={total}
            initial={{ scale: 0.94 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 18 }}
            style={{ fontSize: 30, fontWeight: 800, color: BAND.ink, marginTop: 2 }}
          >
            Total: {total.toLocaleString()}
          </motion.div>
        </div>
      </Stage>

      <CheckBar onCheck={() => onSubmit(counts)} disabled={disabled || total === 0} />
    </>
  );
}
