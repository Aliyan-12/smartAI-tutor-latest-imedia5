import { useRef, useState } from "react";
import type React from "react";
import { motion } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { Stage, CheckBar, BAND } from "./Shell";

/**
 * ClockHands — drag the hands of a real analogue clock to show a time.
 *
 * The Time topic had NO hands-on activity, so the tutor kept typing "what time is it?" into the
 * chat — a question a five-year-old cannot answer by typing. Here they grab a hand and move it.
 * Minutes snap to the key stage's step (15 for KS1, 5 for KS2) so a near-miss drag can't fail
 * them on precision they were never asked for.
 */

const R = 108;

export default function ClockHands({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const step = (payload.params.step as number) || 5;
  const [hour, setHour] = useState(12);
  const [minute, setMinute] = useState(0);
  const [active, setActive] = useState<"hour" | "minute">("minute");
  const svgRef = useRef<SVGSVGElement | null>(null);

  /** Pointer → angle from 12 o'clock, clockwise, in degrees. */
  const angleFrom = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return deg;
  };

  const applyAngle = (deg: number) => {
    if (active === "minute") {
      const m = (Math.round(deg / 6 / step) * step) % 60;
      setMinute(m);
    } else {
      const h = Math.round(deg / 30) % 12;
      setHour(h === 0 ? 12 : h);
    }
  };

  const onPointer = (e: React.PointerEvent) => {
    if (disabled) return;
    if (e.type === "pointermove" && e.buttons === 0) return;   // only while dragging
    const deg = angleFrom(e);
    if (deg !== null) applyAngle(deg);
  };

  const minuteAngle = minute * 6;
  // The hour hand creeps between the numbers as the minutes pass — that's how a real clock reads.
  const hourAngle = (hour % 12) * 30 + (minute / 60) * 30;
  const hand = (deg: number, len: number, w: number, colour: string) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x2: Math.cos(rad) * len, y2: Math.sin(rad) * len, w, colour };
  };
  const hh = hand(hourAngle, R * 0.5, 7, BAND.ink);
  const mh = hand(minuteAngle, R * 0.78, 5, BAND.blue);

  const two = (n: number) => String(n).padStart(2, "0");

  return (
    <>
      <Stage style={{ gap: 14 }}>
        <div style={{ display: "flex", gap: 10 }}>
          {(["hour", "minute"] as const).map((w) => (
            <button
              key={w}
              onClick={() => !disabled && setActive(w)}
              disabled={disabled}
              style={{
                minHeight: 44, padding: "0 18px", borderRadius: 11, fontFamily: "inherit",
                fontSize: 14, fontWeight: 800, cursor: disabled ? "default" : "pointer",
                color: active === w ? "#fff" : BAND.ink,
                background: active === w ? (w === "hour" ? BAND.ink : BAND.blue) : "#fff",
                border: `2px solid ${active === w ? (w === "hour" ? BAND.ink : BAND.blue) : BAND.line}`,
              }}
            >
              {w === "hour" ? "Short hand (hour)" : "Long hand (minutes)"}
            </button>
          ))}
        </div>

        <svg
          ref={svgRef}
          width="248" height="248" viewBox="-124 -124 248 248"
          onPointerDown={onPointer}
          onPointerMove={onPointer}
          style={{ touchAction: "none", cursor: disabled ? "default" : "pointer" }}
        >
          <circle cx="0" cy="0" r={R + 10} fill="#fff" stroke={BAND.line} strokeWidth="3" />
          {/* minute ticks */}
          {Array.from({ length: 60 }, (_, i) => {
            const a = ((i * 6 - 90) * Math.PI) / 180;
            const big = i % 5 === 0;
            const r1 = R - (big ? 12 : 5);
            return (
              <line key={i} x1={Math.cos(a) * r1} y1={Math.sin(a) * r1}
                    x2={Math.cos(a) * R} y2={Math.sin(a) * R}
                    stroke={big ? "#94a3b8" : "#e2e8f0"} strokeWidth={big ? 2.4 : 1.2} />
            );
          })}
          {/* hour numbers */}
          {Array.from({ length: 12 }, (_, i) => {
            const n = i === 0 ? 12 : i;
            const a = ((n * 30 - 90) * Math.PI) / 180;
            return (
              <text key={n} x={Math.cos(a) * (R - 28)} y={Math.sin(a) * (R - 28) + 7}
                    textAnchor="middle" fontSize="20" fontWeight="800" fill={BAND.ink}>
                {n}
              </text>
            );
          })}
          <motion.line animate={{ x2: mh.x2, y2: mh.y2 }} transition={{ type: "spring", stiffness: 380, damping: 26 }}
                       x1="0" y1="0" stroke={mh.colour} strokeWidth={mh.w} strokeLinecap="round" />
          <motion.line animate={{ x2: hh.x2, y2: hh.y2 }} transition={{ type: "spring", stiffness: 380, damping: 26 }}
                       x1="0" y1="0" stroke={hh.colour} strokeWidth={hh.w} strokeLinecap="round" />
          <circle cx="0" cy="0" r="7" fill={BAND.ink} />
        </svg>

        <div style={{ fontSize: 26, fontWeight: 800, color: BAND.ink, letterSpacing: "0.04em" }}>
          {hour}:{two(minute)}
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: BAND.muted }}>
          Pick a hand above, then drag it around the clock
        </span>
      </Stage>

      <CheckBar onCheck={() => onSubmit({ hour, minute })} disabled={disabled} />
    </>
  );
}
