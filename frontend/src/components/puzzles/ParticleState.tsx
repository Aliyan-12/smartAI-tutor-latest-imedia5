import { useMemo } from "react";
import type { DisplayPuzzleProps } from "./types";

export default function ParticleState({ params }: DisplayPuzzleProps) {
  const state = String(params.state || "solid");
  const W = 240, H = 180;

  const pts = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    if (state === "solid") {
      for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) out.push({ x: 48 + c * 29, y: 38 + r * 28 });
    } else if (state === "liquid") {
      for (let i = 0; i < 22; i++) {
        const r = Math.floor(i / 6), c = i % 6;
        out.push({ x: 46 + c * 30 + (Math.random() * 12 - 6), y: 55 + r * 30 + (Math.random() * 12 - 6) });
      }
    } else {
      for (let i = 0; i < 9; i++) out.push({ x: 36 + Math.random() * (W - 72), y: 28 + Math.random() * (H - 56) });
    }
    return out;
  }, [state]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 280 }}>
      <rect x={4} y={4} width={W - 8} height={H - 8} rx={8} fill="#f8fafc" stroke="#cbd5e1" strokeWidth={2} />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={9} fill="#1a73e8" stroke="#1557b0" strokeWidth={1} />
      ))}
    </svg>
  );
}
