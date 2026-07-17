import { useState } from "react";
import { motion } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { Stage, CheckBar, BAND, Stepper } from "./Shell";

/**
 * EquationBalance — a beam that TILTS in real time as x changes, until ax + b = c balances.
 *
 * Advanced maths done hands-on: a KS3-KS5 student gets the feel of "whatever you do to one side
 * you do to the other" instead of counters. The tilt is proportional to how far off they are, so
 * near-misses look nearly level and the student can home in — the beam is the feedback.
 */
export default function EquationBalance({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const a = (payload.params.a as number) ?? 1;
  const b = (payload.params.b as number) ?? 0;
  const c = (payload.params.c as number) ?? 0;
  const equation = (payload.params.equation as string) || "";
  const min = (payload.params.min as number) ?? -20;
  const max = (payload.params.max as number) ?? 20;

  const [x, setX] = useState(0);

  const lhs = a * x + b;
  const diff = lhs - c;
  const balanced = diff === 0;
  // Cap the tilt so a wildly wrong x doesn't spin the beam off the panel.
  const tilt = Math.max(-14, Math.min(14, diff * 1.6));

  const pan = (label: string, value: number, colour: string, dy: number) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                  transform: `translateY(${dy}px)`, transition: "transform .35s" }}>
      <div style={{
        minWidth: 116, padding: "14px 16px", borderRadius: 14, textAlign: "center",
        background: "#fff", border: `3px solid ${colour}`,
        boxShadow: "0 4px 0 rgba(0,0,0,0.10)",
      }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: BAND.muted }}>{label}</div>
        <motion.div key={value} initial={{ scale: 1.2 }} animate={{ scale: 1 }}
                    style={{ fontSize: 28, fontWeight: 800, color: colour }}>
          {value}
        </motion.div>
      </div>
    </div>
  );

  return (
    <>
      <Stage style={{ gap: 16 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: BAND.ink, letterSpacing: "0.02em" }}>
          {equation}
        </div>

        {/* the beam */}
        <div style={{ position: "relative", width: 400, height: 150 }}>
          <motion.div
            animate={{ rotate: tilt }}
            transition={{ type: "spring", stiffness: 120, damping: 14 }}
            style={{
              position: "absolute", top: 44, left: 0, width: "100%",
              display: "flex", justifyContent: "space-between", alignItems: "flex-start",
              transformOrigin: "50% 92px",
            }}
          >
            {pan(`${a}x ${b >= 0 ? "+" : "−"} ${Math.abs(b)}`, lhs, balanced ? BAND.green : BAND.blue, 0)}
            <div style={{ flex: 1, height: 8, background: BAND.ink, borderRadius: 4, margin: "26px 6px 0" }} />
            {pan("=", c, balanced ? BAND.green : BAND.orange, 0)}
          </motion.div>
          {/* the pivot */}
          <div style={{
            position: "absolute", left: "50%", top: 100, transform: "translateX(-50%)",
            width: 0, height: 0, borderLeft: "18px solid transparent",
            borderRight: "18px solid transparent",
            borderBottom: `40px solid ${balanced ? BAND.green : "#94a3b8"}`,
            transition: "border-color .25s",
          }} />
        </div>

        {/* x control */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: BAND.purple }}>x =</span>
          <Stepper sign="−" colour={BAND.purple} disabled={disabled || x <= min} onClick={() => setX((v) => Math.max(min, v - 1))} />
          <motion.span key={x} initial={{ scale: 1.3 }} animate={{ scale: 1 }}
                       style={{ minWidth: 56, textAlign: "center", fontSize: 30, fontWeight: 800, color: BAND.ink }}>
            {x}
          </motion.span>
          <Stepper sign="+" colour={BAND.purple} disabled={disabled || x >= max} onClick={() => setX((v) => Math.min(max, v + 1))} />
        </div>
        <input
          type="range" min={min} max={max} value={x} disabled={disabled}
          onChange={(e) => setX(Number(e.target.value))}
          style={{ width: "min(100%, 380px)", accentColor: BAND.purple }}
        />

        <span style={{ fontSize: 14, fontWeight: 700, color: balanced ? BAND.green : BAND.muted }}>
          {balanced ? "Level! Both sides are equal — press Check."
                    : `Left is ${Math.abs(diff)} ${diff > 0 ? "too heavy" : "too light"}`}
        </span>
      </Stage>

      <CheckBar onCheck={() => onSubmit({ x })} disabled={disabled} />
    </>
  );
}
