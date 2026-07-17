import { useState } from "react";
import { motion } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { Stage, CheckBar, BAND } from "./Shell";

/**
 * PhScale — slide a marker along a real 0-14 pH scale in universal-indicator colours.
 *
 * The colour ramp does the teaching: red acids on the left, green neutral in the middle, blue/
 * purple alkalis on the right. The substance's true pH is server-owned, so the tutor can't put
 * lemon juice at pH 9.
 */

// Universal indicator, roughly: pH 0 red → 7 green → 14 violet.
const PH_COLOURS = [
  "#e11d48", "#ef4444", "#f97316", "#f59e0b", "#eab308", "#a3e635", "#65a30d",
  "#16a34a", "#14b8a6", "#0891b2", "#0ea5e9", "#3b82f6", "#6366f1", "#7c3aed", "#5b21b6",
];

export default function PhScale({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const substance = (payload.params.substance as string) || "this substance";
  const [ph, setPh] = useState(7);

  const band = ph < 7 ? "Acidic" : ph === 7 ? "Neutral" : "Alkaline";
  const bandColour = ph < 7 ? "#e11d48" : ph === 7 ? BAND.green : "#6366f1";

  return (
    <>
      <Stage style={{ gap: 20 }}>
        <div style={{
          padding: "10px 22px", borderRadius: 14, background: "#fff",
          border: `2px solid ${BAND.line}`, fontSize: 19, fontWeight: 800, color: BAND.ink,
        }}>
          {substance}
        </div>

        {/* the scale */}
        <div style={{ width: "100%", maxWidth: 640, padding: "0 10px" }}>
          <div style={{ display: "flex", borderRadius: 12, overflow: "hidden", height: 54 }}>
            {PH_COLOURS.map((c, i) => (
              <button
                key={i}
                onClick={() => !disabled && setPh(i)}
                disabled={disabled}
                aria-label={`pH ${i}`}
                style={{
                  flex: 1, background: c, border: "none", cursor: disabled ? "default" : "pointer",
                  opacity: ph === i ? 1 : 0.55, transition: "opacity .12s",
                  position: "relative",
                }}
              />
            ))}
          </div>
          {/* numbers under the ramp */}
          <div style={{ display: "flex", marginTop: 4 }}>
            {PH_COLOURS.map((_c, i) => (
              <span key={i} style={{
                flex: 1, textAlign: "center", fontSize: 12,
                fontWeight: ph === i ? 800 : 600,
                color: ph === i ? BAND.ink : BAND.muted,
              }}>{i}</span>
            ))}
          </div>
          {/* the marker */}
          <div style={{ position: "relative", height: 30, marginTop: 2 }}>
            <motion.div
              animate={{ left: `${((ph + 0.5) / 15) * 100}%` }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              style={{
                position: "absolute", transform: "translateX(-50%)",
                display: "flex", flexDirection: "column", alignItems: "center",
              }}
            >
              <span style={{ fontSize: 18, color: PH_COLOURS[ph], lineHeight: 1 }}>▲</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: BAND.ink }}>pH {ph}</span>
            </motion.div>
          </div>
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 18px", borderRadius: 12,
          background: `${bandColour}18`, border: `2px solid ${bandColour}`,
        }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: bandColour }}>{band}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: BAND.muted }}>
            {ph < 7 ? "below 7" : ph === 7 ? "exactly 7" : "above 7"}
          </span>
        </div>
      </Stage>

      <CheckBar onCheck={() => onSubmit({ ph })} disabled={disabled} />
    </>
  );
}
