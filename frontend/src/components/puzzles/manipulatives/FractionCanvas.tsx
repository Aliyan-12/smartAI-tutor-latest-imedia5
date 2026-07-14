import { useState } from "react";
import { motion } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { BAND, CheckBar, Stage } from "./Shell";
import { playTapSound } from "../../../lib/sounds";

const FILL_COLOURS = ["#2563eb", "#16a34a", "#f97316", "#ec4899", "#7c3aed", "#dc2626", "#eab308", "#0891b2"];

/**
 * Build a fraction by hand: take a whole shape, SPLIT it into equal parts with the hammers
 * (÷2, ÷3, ÷5), then COLOUR IN the parts you want. The child arrives at "3/4" by making it,
 * not by reading it off a picture.
 *
 * Splitting is multiplicative, which is the real lesson: ÷2 then ÷2 gives quarters, ÷2 then
 * ÷3 gives sixths. Glue puts the whole thing back together so they can try another route.
 */
export default function FractionCanvas({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  // A bar one time, a pie the next — the server alternates. 3/4 of a rectangle and 3/4 of a
  // circle are the same fraction, and a child who has only ever met one hasn't really met it.
  const shape = (payload.params.shape as string) || "rectangle";

  const [parts, setParts] = useState(1);
  const [filled, setFilled] = useState<Set<number>>(new Set());
  const [colour, setColour] = useState(FILL_COLOURS[0]);

  const split = (by: number) => {
    if (disabled || parts * by > 24) return;
    playTapSound();
    setParts(parts * by);
    setFilled(new Set());   // the pieces changed, so the old colouring is meaningless
  };

  const glue = () => {
    if (disabled) return;
    playTapSound();
    setParts(1);
    setFilled(new Set());
  };

  const toggle = (i: number) => {
    if (disabled) return;
    playTapSound();
    setFilled((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  // Lay the parts out as a grid that stays as square as possible, so 6 reads as 2×3 rather
  // than one thin strip of 6.
  const cols = Math.min(parts, Math.ceil(Math.sqrt(parts)));
  const rows = Math.ceil(parts / cols);

  const SIZE = 400;

  /** One pie slice as an SVG wedge. A whole (parts === 1) is just the circle. */
  const wedge = (i: number) => {
    const r = SIZE / 2 - 6;
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    if (parts === 1) return `M ${cx} ${cy} m ${-r} 0 a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`;
    const a0 = (i / parts) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1) / parts) * 2 * Math.PI - Math.PI / 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return [
      `M ${cx} ${cy}`,
      `L ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)}`,
      `A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`,
      "Z",
    ].join(" ");
  };

  const board = shape === "circle" ? (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      style={{ width: "min(58vh, 420px)", height: "min(58vh, 420px)" }}
    >
      {Array.from({ length: parts }, (_, i) => (
        <path
          key={`${parts}-${i}`}
          d={wedge(i)}
          fill={filled.has(i) ? colour : "#f8fafc"}
          stroke={BAND.ink}
          strokeWidth={4}
          style={{ cursor: disabled ? "default" : "pointer", transition: "fill .15s" }}
          onClick={() => toggle(i)}
        />
      ))}
    </svg>
  ) : (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        gap: 3,
        width: "min(58vh, 420px)",
        height: "min(58vh, 420px)",
        border: `4px solid ${BAND.ink}`,
        borderRadius: 8,
        background: BAND.ink,
        padding: 3,
      }}
    >
      {Array.from({ length: parts }, (_, i) => (
        <motion.button
          key={`${parts}-${i}`}
          layout
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 26 }}
          onClick={() => toggle(i)}
          disabled={disabled}
          aria-label={`Part ${i + 1}`}
          style={{
            border: "none",
            borderRadius: 4,
            cursor: disabled ? "default" : "pointer",
            background: filled.has(i) ? colour : "#f8fafc",
            transition: "background .15s",
          }}
        />
      ))}
    </div>
  );

  return (
    <>
      <Stage style={{ flexDirection: "row", alignItems: "center", gap: 24 }}>
        {board}

        {/* Tools */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: BAND.muted, textTransform: "uppercase", letterSpacing: ".04em" }}>
            Split
          </div>
          {[2, 3, 5].map((by) => (
            <button
              key={by}
              onClick={() => split(by)}
              disabled={disabled || parts * by > 24}
              style={{
                minWidth: 96, minHeight: 46, borderRadius: 12, fontFamily: "inherit",
                border: `2px solid ${BAND.line}`, background: "#fff",
                fontSize: 16, fontWeight: 800, color: BAND.ink,
                cursor: disabled || parts * by > 24 ? "not-allowed" : "pointer",
                opacity: parts * by > 24 ? 0.4 : 1,
              }}
            >
              🔨 ÷{by}
            </button>
          ))}
          <button
            onClick={glue}
            disabled={disabled || parts === 1}
            style={{
              minWidth: 96, minHeight: 46, borderRadius: 12, fontFamily: "inherit",
              border: `2px solid ${BAND.line}`, background: "#fff",
              fontSize: 16, fontWeight: 800, color: BAND.ink,
              cursor: disabled || parts === 1 ? "not-allowed" : "pointer",
              opacity: parts === 1 ? 0.4 : 1,
            }}
          >
            🧴 Glue
          </button>

          <div style={{ fontSize: 12, fontWeight: 800, color: BAND.muted, textTransform: "uppercase", letterSpacing: ".04em", marginTop: 6 }}>
            Fill
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 7, width: 96 }}>
            {FILL_COLOURS.map((c) => (
              <button
                key={c}
                onClick={() => setColour(c)}
                disabled={disabled}
                aria-label={`Fill colour ${c}`}
                style={{
                  width: 20, height: 20, borderRadius: "50%", background: c,
                  border: colour === c ? `3px solid ${BAND.ink}` : "2px solid #fff",
                  cursor: disabled ? "default" : "pointer",
                  boxShadow: "0 0 0 1px #e2e8f0",
                }}
              />
            ))}
          </div>

          <div style={{ marginTop: 10, fontSize: 30, fontWeight: 800, color: BAND.ink, textAlign: "center" }}>
            {filled.size}<span style={{ color: BAND.line }}>/</span>{parts}
          </div>
        </div>
      </Stage>

      <CheckBar
        onCheck={() => onSubmit({ denominator: parts, shaded: filled.size })}
        disabled={disabled || parts === 1}
        hint={parts === 1 ? "Split the shape first" : undefined}
      />
    </>
  );
}
