import type { DisplayPuzzleProps } from "./types";

const COLORS = ["#7c3aed", "#1a73e8", "#10b981", "#f97316", "#ef4444", "#06b6d4", "#eab308", "#ec4899"];

export default function PieFraction({ params }: DisplayPuzzleProps) {
  const total = Math.max(2, Number(params.total) || 4);
  const shaded = Math.min(total, Math.max(0, Number(params.shaded) || 0));
  const cx = 110, cy = 110, r = 100;

  const slicePath = (i: number) => {
    const a0 = (i / total) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1) / total) * 2 * Math.PI - Math.PI / 2;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`;
  };

  return (
    <svg viewBox="0 0 220 220" style={{ width: "100%", maxWidth: 230 }}>
      {Array.from({ length: total }).map((_, i) => (
        <path key={i} d={slicePath(i)} fill={i < shaded ? COLORS[i % COLORS.length] : "#f1f5f9"} stroke="#fff" strokeWidth={2} />
      ))}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#94a3b8" strokeWidth={2} />
    </svg>
  );
}
