import { useState } from "react";
import { motion } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { Stage, CheckBar, BAND, Stepper } from "./Shell";

/**
 * ForceArrows — two forces drawn TO SCALE on a box, EACH in its own direction; the student gives
 * the resultant.
 *
 * Force A is drawn on the upper rope, force B on the lower one, and each arrow emanates from the
 * box pointing the way that force actually acts. Arrowheads use `orient="auto"` on a single
 * right-pointing shape, so the head follows the LINE's direction — that's the fix for the old bug
 * where a left force still rendered a right-pointing head (a left-drawn head + orient="auto"
 * flipped 180°), which made both forces look rightward while the tutor was subtracting.
 *
 * Because each arrow shows its true direction, the picture matches the physics: same-direction
 * forces visibly point the same way (ADD), opposite forces point apart (SUBTRACT).
 */
export default function ForceArrows({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const a = (payload.params.a as number) ?? 0;
  const b = (payload.params.b as number) ?? 0;
  const aDir = ((payload.params.a_dir as string) || "right") === "left" ? "left" : "right";
  const bDir = ((payload.params.b_dir as string) || "left") === "left" ? "left" : "right";
  const max = (payload.params.max as number) || Math.max(a, b, 1);

  const [magnitude, setMagnitude] = useState(0);
  const [direction, setDirection] = useState<string>("");

  const W = 460, H = 168, cx = 230, cy = 74, boxW = 56, boxH = 56;
  const boxL = cx - boxW / 2, boxR = cx + boxW / 2;
  const len = (v: number) => 30 + (v / max) * 104;   // px, always visible even for small N

  const arrow = (mag: number, dir: "left" | "right", yOff: number, colour: string,
                 headId: string, key: string) => {
    if (mag <= 0) return null;
    const y = cy + yOff;
    const startX = dir === "right" ? boxR : boxL;         // tail at the box edge
    const endX = dir === "right" ? boxR + len(mag) : boxL - len(mag);   // head out in `dir`
    return (
      <g key={key}>
        <line x1={startX} y1={y} x2={endX} y2={y} stroke={colour} strokeWidth="6"
              markerEnd={`url(#${headId})`} strokeLinecap="round" />
        <text x={(startX + endX) / 2} y={y - 11} textAnchor="middle"
              fontSize="15" fontWeight="800" fill={colour}>{mag} N</text>
      </g>
    );
  };

  return (
    <>
      <Stage style={{ gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: "100%" }}>
            <defs>
              {/* one right-pointing head shape per colour; orient="auto" rotates it to the line */}
              <marker id="fa-head-a" markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto">
                <polygon points="0 0, 8 4, 0 8" fill={BAND.orange} />
              </marker>
              <marker id="fa-head-b" markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto">
                <polygon points="0 0, 8 4, 0 8" fill={BAND.green} />
              </marker>
            </defs>

            {/* ground */}
            <line x1="16" y1={cy + boxH / 2 + 6} x2={W - 16} y2={cy + boxH / 2 + 6}
                  stroke="#cbd5e1" strokeWidth="2" />
            {/* the box */}
            <rect x={boxL} y={cy - boxH / 2} width={boxW} height={boxH} rx="7"
                  fill="rgba(37,99,235,0.12)" stroke={BAND.blue} strokeWidth="2.5" />

            {arrow(a, aDir, -13, BAND.orange, "fa-head-a", "A")}
            {arrow(b, bDir, 13, BAND.green, "fa-head-b", "B")}
          </svg>
        </div>

        {/* answer: size + direction */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: BAND.muted }}>Resultant</span>
          <Stepper sign="−" disabled={disabled || magnitude <= 0} onClick={() => setMagnitude((m) => Math.max(0, m - 5))} />
          <motion.span key={magnitude} initial={{ scale: 1.3 }} animate={{ scale: 1 }}
                       style={{ minWidth: 88, textAlign: "center", fontSize: 26, fontWeight: 800, color: BAND.ink }}>
            {magnitude} N
          </motion.span>
          <Stepper sign="+" disabled={disabled || magnitude >= max * 2} onClick={() => setMagnitude((m) => m + 5)} />
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          {([["left", "← Left"], ["balanced", "Balanced (0 N)"], ["right", "Right →"]] as const).map(([value, label]) => {
            const on = direction === value;
            return (
              <button
                key={value}
                onClick={() => !disabled && setDirection(value)}
                disabled={disabled}
                style={{
                  minHeight: 50, padding: "0 18px", borderRadius: 12, fontFamily: "inherit",
                  fontSize: 15, fontWeight: 800, cursor: disabled ? "default" : "pointer",
                  color: on ? "#fff" : BAND.ink,
                  background: on ? BAND.blue : "#fff",
                  border: `2px solid ${on ? BAND.blue : BAND.line}`,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </Stage>

      <CheckBar
        onCheck={() => onSubmit({ magnitude, direction })}
        disabled={disabled || !direction}
        hint={direction ? undefined : "Pick a direction"}
      />
    </>
  );
}
