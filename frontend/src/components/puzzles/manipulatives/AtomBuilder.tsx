import { useState } from "react";
import { motion } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { Stage, CheckBar, BAND, Stepper } from "./Shell";

/**
 * AtomBuilder — add protons, neutrons and electrons and watch the atom assemble live.
 *
 * The nucleus grows as protons/neutrons go in, and electrons fill the shells 2,8,8,2 in order,
 * so shell structure is something the student SEES rather than memorises. The element data
 * (atomic number, mass number, ion charge) is server-owned, so the tutor can never assert that
 * sodium has 12 protons. The server varies the ask between a neutral atom, an isotope and an
 * ion, so the same element doesn't rebuild the same activity twice.
 */

const SHELL_R = [34, 52, 70, 88];

export default function AtomBuilder({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const symbol = (payload.params.symbol as string) || "?";
  const element = (payload.params.element as string) || "";
  const z = (payload.params.atomic_number as number) ?? 0;
  const massNumber = (payload.params.mass_number as number) ?? 0;
  const capacity = (payload.params.shell_capacity as number[]) || [2, 8, 8, 2];
  const charge = (payload.params.charge as number) ?? 0;

  const [p, setP] = useState(0);
  const [n, setN] = useState(0);
  const [e, setE] = useState(0);

  // fill shells in order: 2, then 8, then 8, then 2
  const shells: number[] = [];
  let left = e;
  for (const cap of capacity) {
    const put = Math.min(cap, Math.max(0, left));
    shells.push(put);
    left -= put;
  }

  const netCharge = p - e;
  const chargeLabel = netCharge === 0 ? "neutral" : `${Math.abs(netCharge)}${netCharge > 0 ? "+" : "−"}`;

  const row = (label: string, value: number, set: (v: number) => void, colour: string, max: number) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ width: 84, fontSize: 14, fontWeight: 800, color: colour }}>{label}</span>
      <Stepper sign="−" colour={colour} disabled={disabled || value <= 0} onClick={() => set(Math.max(0, value - 1))} />
      <span style={{
        minWidth: 46, textAlign: "center", fontSize: 24, fontWeight: 800, color: BAND.ink,
      }}>{value}</span>
      <Stepper sign="+" colour={colour} disabled={disabled || value >= max} onClick={() => set(Math.min(max, value + 1))} />
    </div>
  );

  return (
    <>
      <Stage style={{ flexDirection: "row", flexWrap: "wrap", gap: 26 }}>
        {/* the atom */}
        <svg width="230" height="230" viewBox="-115 -115 230 230" style={{ flexShrink: 0 }}>
          {capacity.map((_c, i) => (
            <circle key={i} cx="0" cy="0" r={SHELL_R[i]} fill="none"
                    stroke={shells[i] > 0 ? "rgba(37,99,235,0.35)" : "rgba(148,163,184,0.25)"}
                    strokeWidth="1.2" strokeDasharray="3 4" />
          ))}
          {/* nucleus — protons + neutrons packed together */}
          <motion.g animate={{ scale: 1 + Math.min(p + n, 40) * 0.006 }}>
            <circle cx="0" cy="0" r={12 + Math.min(p + n, 40) * 0.35}
                    fill="rgba(236,72,153,0.16)" />
            {Array.from({ length: Math.min(p, 20) }, (_, i) => {
              const a = (i / Math.max(1, Math.min(p, 20))) * Math.PI * 2;
              const r = 4 + (i % 3) * 4;
              return <circle key={`p${i}`} cx={Math.cos(a) * r} cy={Math.sin(a) * r} r="4.2" fill={BAND.pink} />;
            })}
            {Array.from({ length: Math.min(n, 20) }, (_, i) => {
              const a = (i / Math.max(1, Math.min(n, 20))) * Math.PI * 2 + 0.5;
              const r = 6 + (i % 3) * 4;
              return <circle key={`n${i}`} cx={Math.cos(a) * r} cy={Math.sin(a) * r} r="4.2" fill="#94a3b8" />;
            })}
          </motion.g>
          {/* electrons on their shells */}
          {shells.map((count, si) =>
            Array.from({ length: count }, (_, i) => {
              const a = (i / count) * Math.PI * 2 - Math.PI / 2;
              return (
                <motion.circle
                  key={`e${si}-${i}`}
                  initial={{ scale: 0 }} animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  cx={Math.cos(a) * SHELL_R[si]} cy={Math.sin(a) * SHELL_R[si]}
                  r="5" fill={BAND.blue} stroke="#fff" strokeWidth="1.2"
                />
              );
            })
          )}
        </svg>

        {/* controls + live readout */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: BAND.ink }}>
            {element} ({symbol}) · atomic number {z} · mass number {massNumber}
            {charge !== 0 && (
              <span style={{ color: BAND.purple }}> · target charge {Math.abs(charge)}{charge > 0 ? "+" : "−"}</span>
            )}
          </div>
          {row("Protons", p, setP, BAND.pink, 30)}
          {row("Neutrons", n, setN, "#64748b", 40)}
          {row("Electrons", e, setE, BAND.blue, 30)}
          <div style={{ fontSize: 13, fontWeight: 700, color: BAND.muted, marginTop: 2 }}>
            Mass number: <b style={{ color: BAND.ink }}>{p + n}</b> · Charge:{" "}
            <b style={{ color: netCharge === 0 ? BAND.green : BAND.purple }}>{chargeLabel}</b> ·
            Shells: <b style={{ color: BAND.ink }}>{shells.filter((s) => s > 0).join(", ") || "0"}</b>
          </div>
        </div>
      </Stage>

      <CheckBar
        onCheck={() => onSubmit({ protons: p, neutrons: n, electrons: e })}
        disabled={disabled || p + n + e === 0}
      />
    </>
  );
}
