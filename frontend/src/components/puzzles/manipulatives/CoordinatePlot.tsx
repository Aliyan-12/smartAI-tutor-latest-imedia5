import { useState } from "react";
import { motion } from "framer-motion";
import type { InteractivePuzzleProps } from "../types";
import { Stage, CheckBar, BAND } from "./Shell";

/**
 * CoordinatePlot — tap a grid intersection to plot a point.
 *
 * Handles both the KS2 first-quadrant grid (0-10) and the KS3+ four-quadrant grid (-6..6); the
 * server decides which by key stage. Guide lines trace from the axes to the chosen point, so
 * "along the corridor, then up the stairs" is shown rather than just said.
 */
export default function CoordinatePlot({ payload, onSubmit, disabled }: InteractivePuzzleProps) {
  const min = (payload.params.min as number) ?? 0;
  const max = (payload.params.max as number) ?? 10;
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null);

  const SIZE = 380, PAD = 30;
  const span = Math.max(1, max - min);
  const sx = (x: number) => PAD + ((x - min) / span) * (SIZE - PAD * 2);
  const sy = (y: number) => SIZE - PAD - ((y - min) / span) * (SIZE - PAD * 2);
  const values = Array.from({ length: span + 1 }, (_, i) => min + i);
  const labelEvery = span > 12 ? 2 : 1;

  return (
    <>
      <Stage style={{ gap: 14 }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ maxWidth: "100%" }}>
          {/* grid */}
          {values.map((v) => (
            <g key={`g${v}`}>
              <line x1={sx(v)} y1={sy(min)} x2={sx(v)} y2={sy(max)} stroke="#e2e8f0" strokeWidth="1" />
              <line x1={sx(min)} y1={sy(v)} x2={sx(max)} y2={sy(v)} stroke="#e2e8f0" strokeWidth="1" />
            </g>
          ))}
          {/* axes (at 0 for a four-quadrant grid, otherwise at the edges) */}
          <line x1={sx(min)} y1={sy(min <= 0 && max >= 0 ? 0 : min)} x2={sx(max)}
                y2={sy(min <= 0 && max >= 0 ? 0 : min)} stroke={BAND.ink} strokeWidth="2.5" />
          <line x1={sx(min <= 0 && max >= 0 ? 0 : min)} y1={sy(min)}
                x2={sx(min <= 0 && max >= 0 ? 0 : min)} y2={sy(max)} stroke={BAND.ink} strokeWidth="2.5" />

          {/* axis numbers */}
          {values.filter((v) => v % labelEvery === 0).map((v) => (
            <g key={`l${v}`}>
              <text x={sx(v)} y={sy(min <= 0 && max >= 0 ? 0 : min) + 16} textAnchor="middle"
                    fontSize="11" fontWeight="700" fill={BAND.muted}>{v !== 0 ? v : ""}</text>
              <text x={sx(min <= 0 && max >= 0 ? 0 : min) - 10} y={sy(v) + 4} textAnchor="end"
                    fontSize="11" fontWeight="700" fill={BAND.muted}>{v !== 0 ? v : "0"}</text>
            </g>
          ))}

          {/* guide lines to the chosen point */}
          {pt && (
            <>
              <line x1={sx(min <= 0 && max >= 0 ? 0 : min)} y1={sy(pt.y)} x2={sx(pt.x)} y2={sy(pt.y)}
                    stroke={BAND.blue} strokeWidth="1.6" strokeDasharray="4 4" />
              <line x1={sx(pt.x)} y1={sy(min <= 0 && max >= 0 ? 0 : min)} x2={sx(pt.x)} y2={sy(pt.y)}
                    stroke={BAND.blue} strokeWidth="1.6" strokeDasharray="4 4" />
            </>
          )}

          {/* tap targets on every intersection */}
          {values.map((yv) =>
            values.map((xv) => (
              <circle key={`t${xv}-${yv}`} cx={sx(xv)} cy={sy(yv)} r="9" fill="transparent"
                      style={{ cursor: disabled ? "default" : "pointer" }}
                      onClick={() => !disabled && setPt({ x: xv, y: yv })} />
            ))
          )}

          {pt && (
            <motion.circle
              initial={{ scale: 0 }} animate={{ scale: 1, cx: sx(pt.x), cy: sy(pt.y) }}
              transition={{ type: "spring", stiffness: 400, damping: 24 }}
              r="8" fill={BAND.blue} stroke="#fff" strokeWidth="2.5"
            />
          )}
        </svg>

        <span style={{ fontSize: 17, fontWeight: 800, color: pt ? BAND.blue : BAND.muted }}>
          {pt ? `(${pt.x}, ${pt.y})` : "Tap a point on the grid"}
        </span>
      </Stage>

      <CheckBar onCheck={() => pt && onSubmit({ x: pt.x, y: pt.y })} disabled={disabled || !pt} />
    </>
  );
}
