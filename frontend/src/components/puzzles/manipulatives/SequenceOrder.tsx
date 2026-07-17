import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { Stage, CheckBar, BAND } from "./Shell";

/**
 * SequenceOrder — tap the stages one by one to put a process in order.
 *
 * Life cycles, food chains, the water cycle, digestion, mitosis: same shape, many topics. The
 * stages and their true order come from a server-owned bank, so the science is never the
 * tutor's guess. Numbered chips make the "what have I chosen so far" state obvious, and any
 * pick can be undone by tapping it again.
 */
export default function SequenceOrder({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const shown = (payload.params.shown as string[]) || [];
  const [order, setOrder] = useState<string[]>([]);

  const remaining = shown.filter((s) => !order.includes(s));
  const done = remaining.length === 0;

  const pick = (label: string) => {
    if (disabled) return;
    setOrder((o) => (o.includes(label) ? o : [...o, label]));
  };
  const undo = (label: string) => {
    if (disabled) return;
    setOrder((o) => o.filter((x) => x !== label));   // drop it and everything keeps its order
  };

  return (
    <>
      <Stage style={{ justifyContent: "flex-start", gap: 16, overflowY: "auto" }}>
        {/* chosen order */}
        <div style={{
          width: "100%", maxWidth: 700, minHeight: 74, borderRadius: 16,
          border: `2px dashed ${order.length ? BAND.green : BAND.line}`,
          background: order.length ? "rgba(22,163,74,0.05)" : "#fff",
          display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
          justifyContent: "center", padding: 10,
        }}>
          <AnimatePresence>
            {order.length === 0 ? (
              <span style={{ color: BAND.muted, fontWeight: 600, fontSize: 14 }}>
                Tap the stages below in order — first one first
              </span>
            ) : (
              order.map((label, i) => (
                <motion.button
                  key={label}
                  layout
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  onClick={() => undo(label)}
                  disabled={disabled}
                  title="Tap to remove"
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "9px 14px", borderRadius: 11, border: "none",
                    fontFamily: "inherit", fontSize: 15, fontWeight: 700, color: "#fff",
                    background: BAND.green, cursor: disabled ? "default" : "pointer",
                  }}
                >
                  <span style={{
                    width: 21, height: 21, borderRadius: "50%", fontSize: 12, fontWeight: 800,
                    background: "rgba(255,255,255,0.28)", display: "flex",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    {i + 1}
                  </span>
                  {label}
                </motion.button>
              ))
            )}
          </AnimatePresence>
        </div>

        {/* the pool */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
          <AnimatePresence>
            {remaining.map((label) => (
              <motion.button
                key={label}
                layout
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                whileTap={{ scale: 0.94 }}
                onClick={() => pick(label)}
                disabled={disabled}
                style={{
                  minHeight: 52, padding: "0 20px", borderRadius: 13,
                  fontFamily: "inherit", fontSize: 16, fontWeight: 700, color: BAND.ink,
                  background: "#fff", border: `2px solid ${BAND.line}`,
                  boxShadow: "0 3px 0 rgba(0,0,0,0.08)",
                  cursor: disabled ? "default" : "pointer",
                }}
              >
                {label}
              </motion.button>
            ))}
          </AnimatePresence>
          {done && (
            <span style={{ color: BAND.muted, fontWeight: 600, fontSize: 14 }}>
              All placed — press Check!
            </span>
          )}
        </div>
      </Stage>

      <CheckBar
        onCheck={() => onSubmit({ order })}
        disabled={disabled || !done}
        hint={done ? undefined : `${remaining.length} left`}
      />
    </>
  );
}
