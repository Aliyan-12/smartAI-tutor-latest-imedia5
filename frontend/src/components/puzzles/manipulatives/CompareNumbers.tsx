import { useState } from "react";
import { motion } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { BAND, CheckBar, Stage } from "./Shell";
import { playTapSound } from "../../../lib/sounds";

/**
 * Comparing numbers, as a puzzle instead of a plain-text question.
 *
 * The tutor used to ask "which is bigger, 29 or 92?" in chat and wait for a typed reply. Now
 * two big number cards appear and the child TAPS the answer:
 *   • bigger / smaller — tap the correct number card.
 *   • sign             — tap the <, = or > that belongs between them.
 *
 * The server picks the style, the phrasing, the colours and the correct answer (all derived
 * from the two numbers), so the activity can never disagree with the marking — and every one
 * looks a little different from the last.
 */
export default function CompareNumbers({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const left = String(payload.params.left ?? "");
  const right = String(payload.params.right ?? "");
  const mode = (payload.params.mode as string) || "bigger";
  const colours = (payload.params.colours as string[]) || ["#3b82f6", "#ec4899"];
  const signs = (payload.params.signs as string[]) || ["<", "=", ">"];

  const [picked, setPicked] = useState<string | null>(null);
  const isSign = mode === "sign";

  const pick = (v: string) => {
    if (disabled) return;
    playTapSound();
    setPicked(v);
  };

  const Card = ({ value, colour, selectable }: { value: string; colour: string; selectable: boolean }) => {
    const chosen = picked === value;
    return (
      <motion.button
        onClick={() => selectable && pick(value)}
        disabled={disabled || !selectable}
        initial={{ scale: 0.8, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        whileTap={selectable ? { scale: 0.94 } : undefined}
        style={{
          minWidth: 148, minHeight: 148, padding: "0 22px", borderRadius: 26,
          fontSize: 68, fontWeight: 800, fontFamily: "inherit",
          color: chosen ? "#fff" : colour,
          background: chosen ? colour : "#fff",
          border: `5px solid ${colour}`,
          cursor: selectable && !disabled ? "pointer" : "default",
          boxShadow: chosen ? `0 12px 30px ${colour}66` : "0 6px 0 rgba(0,0,0,0.10)",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "background .15s, color .15s, box-shadow .15s",
        }}
      >
        {value}
      </motion.button>
    );
  };

  return (
    <>
      <Stage style={{ gap: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20, flexWrap: "wrap" }}>
          <Card value={left} colour={colours[0]} selectable={!isSign} />
          {isSign ? (
            <div style={{
              minWidth: 74, minHeight: 74, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 46, fontWeight: 800, color: picked ? BAND.ink : "#cbd5e1",
              border: `3px dashed ${picked ? BAND.ink : BAND.line}`, borderRadius: 16, background: "#fff",
            }}>
              {picked || "?"}
            </div>
          ) : null}
          <Card value={right} colour={colours[1]} selectable={!isSign} />
        </div>

        {isSign ? (
          <div style={{ display: "flex", gap: 16 }}>
            {signs.map((s) => {
              const chosen = picked === s;
              return (
                <motion.button
                  key={s}
                  onClick={() => pick(s)}
                  disabled={disabled}
                  whileTap={{ scale: 0.92 }}
                  aria-label={`sign ${s}`}
                  style={{
                    width: 84, height: 84, borderRadius: 18, fontSize: 42, fontWeight: 800,
                    fontFamily: "inherit", cursor: disabled ? "default" : "pointer",
                    color: chosen ? "#fff" : BAND.purple,
                    background: chosen ? BAND.purple : "#fff",
                    border: `4px solid ${BAND.purple}`,
                    boxShadow: chosen ? `0 6px 18px ${BAND.purple}66` : "0 4px 0 rgba(0,0,0,0.12)",
                  }}
                >
                  {s}
                </motion.button>
              );
            })}
          </div>
        ) : null}
      </Stage>

      <CheckBar
        onCheck={() => picked != null && onSubmit(picked)}
        disabled={disabled || picked == null}
        hint={isSign ? "Tap the sign that fits" : "Tap a number"}
      />
    </>
  );
}
