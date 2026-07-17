import { useState } from "react";
import { motion } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { Stage, CheckBar, BAND, Stepper } from "./Shell";

/**
 * ForceArrows — two forces drawn TO SCALE on a box; the student gives the resultant.
 *
 * Arrow length is proportional to the force, so "which is bigger" is visible before any
 * arithmetic. When the two forces are equal the box sits still and the resultant is 0 N —
 * which is how balanced forces should be taught.
 */
export default function ForceArrows({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const left = (payload.params.left as number) ?? 0;
  const right = (payload.params.right as number) ?? 0;
  const max = (payload.params.max as number) || Math.max(left, right, 1);

  const [magnitude, setMagnitude] = useState(0);
  const [direction, setDirection] = useState<string>("");

  const scale = (v: number) => 24 + (v / max) * 96;   // px, always visible even at small N

  const dirBtn = (value: string, label: string) => {
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
  };

  return (
    <>
      <Stage style={{ gap: 20 }}>
        {/* the box and its forces, drawn to scale */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
          <svg width="440" height="150" viewBox="0 0 440 150">
            <defs>
              <marker id="fa-head-l" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <polygon points="7 0, 7 7, 0 3.5" fill={BAND.orange} />
              </marker>
              <marker id="fa-head-r" markerWidth="7" markerHeight="7" refX="1" refY="3.5" orient="auto">
                <polygon points="0 0, 0 7, 7 3.5" fill={BAND.green} />
              </marker>
            </defs>

            {/* ground */}
            <line x1="20" y1="112" x2="420" y2="112" stroke="#cbd5e1" strokeWidth="2" />
            {/* the box */}
            <rect x="190" y="60" width="60" height="52" rx="7" fill="rgba(37,99,235,0.12)"
                  stroke={BAND.blue} strokeWidth="2.5" />

            {/* left force */}
            {left > 0 && (
              <>
                <line x1="188" y1="86" x2={188 - scale(left)} y2="86" stroke={BAND.orange}
                      strokeWidth="5" markerEnd="url(#fa-head-l)" strokeLinecap="round" />
                <text x={188 - scale(left) / 2} y="72" textAnchor="middle"
                      fontSize="15" fontWeight="800" fill={BAND.orange}>{left} N</text>
              </>
            )}
            {/* right force */}
            {right > 0 && (
              <>
                <line x1="252" y1="86" x2={252 + scale(right)} y2="86" stroke={BAND.green}
                      strokeWidth="5" markerEnd="url(#fa-head-r)" strokeLinecap="round" />
                <text x={252 + scale(right) / 2} y="72" textAnchor="middle"
                      fontSize="15" fontWeight="800" fill={BAND.green}>{right} N</text>
              </>
            )}
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
          {dirBtn("left", "← Left")}
          {dirBtn("balanced", "Balanced (0 N)")}
          {dirBtn("right", "Right →")}
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
