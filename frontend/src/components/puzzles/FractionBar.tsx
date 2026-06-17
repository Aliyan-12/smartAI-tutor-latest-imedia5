import type { DisplayPuzzleProps } from "./types";

const COLORS = ["#7c3aed", "#1a73e8", "#10b981", "#f97316", "#ef4444", "#06b6d4"];

export default function FractionBar({ params }: DisplayPuzzleProps) {
  const total = Math.max(2, Number(params.total) || 4);
  const shaded = Math.min(total, Math.max(0, Number(params.shaded) || 0));
  const W = 360, H = 90, cw = W / total;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 420 }}>
      {Array.from({ length: total }).map((_, i) => (
        <rect
          key={i} x={i * cw} y={10} width={cw} height={H - 20}
          fill={i < shaded ? COLORS[i % COLORS.length] : "#f1f5f9"}
          stroke="#fff" strokeWidth={3}
        />
      ))}
      <rect x={0} y={10} width={W} height={H - 20} fill="none" stroke="#94a3b8" strokeWidth={2} />
    </svg>
  );
}
