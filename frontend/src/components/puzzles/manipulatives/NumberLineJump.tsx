import { useState } from "react";
import { motion } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { Stage, CheckBar, BAND } from "./Shell";

/**
 * NumberLineJump — the jumps are DRAWN as arcs along the line, and the student taps where they
 * think they land.
 *
 * A "Show me the jumps" button animates each hop in turn, so a stuck child can watch the
 * strategy instead of being told the answer — the landing point is still theirs to choose.
 */
export default function NumberLineJump({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const min = (payload.params.min as number) ?? 0;
  const max = (payload.params.max as number) ?? 20;
  const start = (payload.params.start as number) ?? 0;
  const step = (payload.params.step as number) ?? 1;
  const jumps = (payload.params.jumps as number) ?? 1;
  const direction = (payload.params.direction as string) || "forward";

  const [picked, setPicked] = useState<number | null>(null);
  const [showJumps, setShowJumps] = useState(false);

  const W = 660, PAD = 26;
  const span = Math.max(1, max - min);
  const x = (n: number) => PAD + ((n - min) / span) * (W - PAD * 2);

  // Only label every tick if the line is short enough to read.
  const labelEvery = span <= 20 ? 1 : span <= 50 ? 5 : 10;
  const ticks = Array.from({ length: span + 1 }, (_, i) => min + i);

  const arcs = Array.from({ length: jumps }, (_, i) => {
    const from = direction === "forward" ? start + step * i : start - step * i;
    const to = direction === "forward" ? from + step : from - step;
    return { from, to };
  });

  return (
    <>
      <Stage style={{ gap: 18 }}>
        <svg width="100%" viewBox={`0 0 ${W} 150`} style={{ maxWidth: W }}>
          {/* jump arcs */}
          {showJumps && arcs.map((a, i) => {
            const x1 = x(a.from), x2 = x(a.to);
            const mid = (x1 + x2) / 2;
            return (
              <motion.path
                key={i}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ delay: i * 0.45, duration: 0.4 }}
                d={`M ${x1} 84 Q ${mid} 26 ${x2} 84`}
                fill="none" stroke={BAND.purple} strokeWidth="3" strokeLinecap="round"
              />
            );
          })}

          {/* the line */}
          <line x1={PAD} y1="86" x2={W - PAD} y2="86" stroke={BAND.ink} strokeWidth="3" />
          {ticks.map((n) => {
            const isStart = n === start;
            const isPicked = picked === n;
            const labelled = n % labelEvery === 0 || isStart;
            return (
              <g key={n}>
                <line x1={x(n)} y1="80" x2={x(n)} y2={labelled ? 96 : 91}
                      stroke={isStart ? BAND.green : "#94a3b8"} strokeWidth={isStart ? 3 : 1.6} />
                {labelled && (
                  <text x={x(n)} y="116" textAnchor="middle" fontSize="13"
                        fontWeight={isPicked || isStart ? 800 : 600}
                        fill={isPicked ? BAND.blue : isStart ? BAND.green : BAND.muted}>
                    {n}
                  </text>
                )}
                {/* generous invisible hit area — small ticks are hard to tap */}
                <rect x={x(n) - 11} y="62" width="22" height="64" fill="transparent"
                      style={{ cursor: disabled ? "default" : "pointer" }}
                      onClick={() => !disabled && setPicked(n)} />
              </g>
            );
          })}

          {/* start marker */}
          <circle cx={x(start)} cy="86" r="7" fill={BAND.green} />
          <text x={x(start)} y="60" textAnchor="middle" fontSize="12" fontWeight="800" fill={BAND.green}>
            start
          </text>

          {/* the student's choice */}
          {picked !== null && (
            <motion.circle
              layout initial={{ scale: 0 }} animate={{ scale: 1, cx: x(picked) }}
              transition={{ type: "spring", stiffness: 380, damping: 24 }}
              cy="86" r="10" fill={BAND.blue} stroke="#fff" strokeWidth="2.5"
            />
          )}
        </svg>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
          <button
            onClick={() => setShowJumps((s) => !s)}
            disabled={disabled}
            style={{
              minHeight: 44, padding: "0 18px", borderRadius: 11, fontFamily: "inherit",
              fontSize: 14, fontWeight: 800, cursor: disabled ? "default" : "pointer",
              color: showJumps ? "#fff" : BAND.purple,
              background: showJumps ? BAND.purple : "#fff",
              border: `2px solid ${BAND.purple}`,
            }}
          >
            {showJumps ? "Hide the jumps" : "Show me the jumps"}
          </button>
          <span style={{ fontSize: 15, fontWeight: 700, color: BAND.muted }}>
            {picked === null ? "Tap where you land" : <>You landed on <b style={{ color: BAND.blue }}>{picked}</b></>}
          </span>
        </div>
      </Stage>

      <CheckBar onCheck={() => onSubmit({ landed: picked })} disabled={disabled || picked === null} />
    </>
  );
}
