import { useState } from "react";
import { motion } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { Stage, CheckBar, BAND, Stepper } from "./Shell";

/**
 * BalanceEquation — set the coefficient in front of each substance and watch a LIVE atom tally
 * on each side of the arrow. Conservation of mass stops being a rule to recite and becomes
 * something you can see going green.
 *
 * The server derives the balanced coefficients itself (null space of the composition matrix),
 * so any sensible equation works — this isn't a fixed list of pre-balanced reactions — and the
 * tutor never supplies an answer.
 */

/** "H2O" → "H₂O" — subscript the digits so formulae read properly. */
const SUBS: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
};
const pretty = (f: string) => f.replace(/\d/g, (d) => SUBS[d] ?? d);

type Atoms = Record<string, number>;

export default function BalanceEquation({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const lhs = (payload.params.lhs as string[]) || [];
  const rhs = (payload.params.rhs as string[]) || [];
  const atoms = (payload.params.atoms as Record<string, Atoms>) || {};
  const elements = (payload.params.elements as string[]) || [];
  const maxCoeff = (payload.params.max_coeff as number) ?? 8;

  const species = [...lhs, ...rhs];
  const [coeffs, setCoeffs] = useState<number[]>(() => species.map(() => 1));

  const countSide = (names: string[], offset: number): Atoms => {
    const total: Atoms = {};
    names.forEach((f, i) => {
      const c = coeffs[offset + i] ?? 0;
      Object.entries(atoms[f] || {}).forEach(([el, n]) => {
        total[el] = (total[el] || 0) + n * c;
      });
    });
    return total;
  };
  const leftAtoms = countSide(lhs, 0);
  const rightAtoms = countSide(rhs, lhs.length);
  const balanced = elements.every((el) => (leftAtoms[el] || 0) === (rightAtoms[el] || 0));

  const set = (i: number, v: number) =>
    setCoeffs((c) => c.map((x, j) => (j === i ? Math.max(1, Math.min(maxCoeff, v)) : x)));

  const term = (f: string, i: number) => (
    <div key={`${f}-${i}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <Stepper sign="−" disabled={disabled || coeffs[i] <= 1} onClick={() => set(i, coeffs[i] - 1)} />
        <motion.span
          key={coeffs[i]}
          initial={{ scale: 1.35 }} animate={{ scale: 1 }}
          style={{ minWidth: 26, textAlign: "center", fontSize: 26, fontWeight: 800,
                   color: coeffs[i] > 1 ? BAND.blue : "#cbd5e1" }}
        >
          {coeffs[i]}
        </motion.span>
        <Stepper sign="+" disabled={disabled || coeffs[i] >= maxCoeff} onClick={() => set(i, coeffs[i] + 1)} />
      </div>
      <span style={{ fontSize: 22, fontWeight: 800, color: BAND.ink }}>{pretty(f)}</span>
    </div>
  );

  const tally = (side: Atoms, label: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
      <span style={{ fontSize: 11, fontWeight: 800, color: BAND.muted, textTransform: "uppercase" }}>{label}</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
        {elements.map((el) => {
          const ok = (leftAtoms[el] || 0) === (rightAtoms[el] || 0);
          return (
            <span key={el} style={{
              padding: "3px 8px", borderRadius: 7, fontSize: 13, fontWeight: 800,
              color: ok ? BAND.green : BAND.orange,
              background: ok ? "rgba(22,163,74,0.12)" : "rgba(249,115,22,0.12)",
            }}>
              {el} {side[el] || 0}
            </span>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <Stage style={{ gap: 18 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          {lhs.map((f, i) => (
            <div key={`l${i}`} style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
              {i > 0 && <span style={{ fontSize: 22, fontWeight: 800, color: BAND.muted, paddingBottom: 4 }}>+</span>}
              {term(f, i)}
            </div>
          ))}
          <span style={{ fontSize: 26, fontWeight: 800, color: BAND.ink, padding: "0 6px 4px" }}>→</span>
          {rhs.map((f, i) => (
            <div key={`r${i}`} style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
              {i > 0 && <span style={{ fontSize: 22, fontWeight: 800, color: BAND.muted, paddingBottom: 4 }}>+</span>}
              {term(f, lhs.length + i)}
            </div>
          ))}
        </div>

        <div style={{
          display: "flex", gap: 26, alignItems: "center", padding: "10px 18px", borderRadius: 14,
          background: balanced ? "rgba(22,163,74,0.10)" : "#f8fafc",
          border: `2px solid ${balanced ? BAND.green : BAND.line}`,
        }}>
          {tally(leftAtoms, "Left")}
          <span style={{ fontSize: 20, fontWeight: 800, color: balanced ? BAND.green : BAND.muted }}>
            {balanced ? "=" : "≠"}
          </span>
          {tally(rightAtoms, "Right")}
        </div>

        <span style={{ fontSize: 14, fontWeight: 700, color: balanced ? BAND.green : BAND.muted }}>
          {balanced ? "Balanced! Every element matches — press Check." : "Not balanced yet — match every element on both sides."}
        </span>
      </Stage>

      <CheckBar onCheck={() => onSubmit({ coefficients: coeffs })} disabled={disabled} />
    </>
  );
}
