import { useState } from "react";
import { motion } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { Stage, CheckBar, BAND, Stepper } from "./Shell";

/**
 * AlgebraTiles — build x² + bx + c as a RECTANGLE and read the factors off its sides.
 *
 * Advanced maths, still hands-on: the student sets the two side lengths (x + p) and (x + q) and
 * the area model redraws live — one x² tile, (p+q) x-tiles, and p×q unit tiles. The expression
 * under it updates as they go and turns green when it matches the target, so factorising is
 * something they can see clicking into place rather than a trial-and-error guess.
 */
export default function AlgebraTiles({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const targetB = (payload.params.b as number) ?? 0;
  const targetC = (payload.params.c as number) ?? 0;
  const expression = (payload.params.expression as string) || "";
  const maxSide = (payload.params.max_side as number) ?? 10;

  const [p, setP] = useState(1);
  const [q, setQ] = useState(1);

  const b = p + q;
  const c = p * q;
  const match = b === targetB && c === targetC;

  const X = 62;          // px for the x-length side
  const U = 20;          // px for a unit

  const sideCtl = (label: string, value: number, set: (v: number) => void, colour: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 16, fontWeight: 800, color: colour, minWidth: 54 }}>x + {value}</span>
      <Stepper sign="−" colour={colour} disabled={disabled || value <= 1} onClick={() => set(value - 1)} />
      <Stepper sign="+" colour={colour} disabled={disabled || value >= maxSide} onClick={() => set(value + 1)} />
      <span style={{ fontSize: 12, fontWeight: 700, color: BAND.muted }}>{label}</span>
    </div>
  );

  return (
    <>
      <Stage style={{ gap: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: BAND.ink }}>
          Target: <span style={{ color: BAND.purple }}>{expression}</span>
        </div>

        {/* the area model */}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          {/* side label (height) */}
          <div style={{
            display: "flex", flexDirection: "column", justifyContent: "center",
            fontSize: 13, fontWeight: 800, color: BAND.pink, writingMode: "vertical-rl",
            transform: "rotate(180deg)", paddingRight: 4,
          }}>
            x + {q}
          </div>

          <div>
            <div style={{ display: "grid", gridTemplateColumns: `${X}px ${p * U}px`, gap: 3 }}>
              {/* x² tile */}
              <motion.div layout style={{
                width: X, height: X, borderRadius: 5, background: "rgba(124,58,237,0.22)",
                border: `2px solid ${BAND.purple}`, display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 15, fontWeight: 800, color: BAND.purple,
              }}>x²</motion.div>
              {/* p x-tiles across the top */}
              <div style={{ display: "flex", gap: 3 }}>
                {Array.from({ length: p }, (_, i) => (
                  <motion.div key={`xt${i}`} layout initial={{ scale: 0 }} animate={{ scale: 1 }}
                              style={{
                                width: U - 3, height: X, borderRadius: 4,
                                background: "rgba(37,99,235,0.20)", border: `1.5px solid ${BAND.blue}`,
                              }} />
                ))}
              </div>
              {/* q x-tiles down the side */}
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {Array.from({ length: q }, (_, i) => (
                  <motion.div key={`yt${i}`} layout initial={{ scale: 0 }} animate={{ scale: 1 }}
                              style={{
                                width: X, height: U - 3, borderRadius: 4,
                                background: "rgba(37,99,235,0.20)", border: `1.5px solid ${BAND.blue}`,
                              }} />
                ))}
              </div>
              {/* p*q unit tiles */}
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${p}, ${U - 3}px)`, gap: 3, alignContent: "start" }}>
                {Array.from({ length: p * q }, (_, i) => (
                  <motion.div key={`u${i}`} layout initial={{ scale: 0 }} animate={{ scale: 1 }}
                              style={{
                                width: U - 3, height: U - 3, borderRadius: 3,
                                background: "rgba(22,163,74,0.22)", border: `1.5px solid ${BAND.green}`,
                              }} />
                ))}
              </div>
            </div>
            {/* side label (width) */}
            <div style={{ textAlign: "center", marginTop: 5, fontSize: 13, fontWeight: 800, color: BAND.blue }}>
              x + {p}
            </div>
          </div>
        </div>

        {/* live expression */}
        <div style={{
          padding: "8px 20px", borderRadius: 12, fontSize: 19, fontWeight: 800,
          color: match ? BAND.green : BAND.ink,
          background: match ? "rgba(22,163,74,0.12)" : "#f8fafc",
          border: `2px solid ${match ? BAND.green : BAND.line}`,
        }}>
          x² + {b}x + {c} {match ? "✓ matches!" : ""}
        </div>

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", justifyContent: "center" }}>
          {sideCtl("width", p, setP, BAND.blue)}
          {sideCtl("height", q, setQ, BAND.pink)}
        </div>
      </Stage>

      <CheckBar onCheck={() => onSubmit({ p, q })} disabled={disabled} />
    </>
  );
}
