import type { DisplayPuzzleProps } from "./types";

const COLORS = ["#7c3aed", "#1a73e8", "#10b981", "#f97316", "#ef4444", "#06b6d4", "#eab308", "#ec4899"];

function Shape({ kind, x, y, color }: { kind: string; x: number; y: number; color: string }) {
  if (kind === "circle") return <circle cx={x} cy={y} r={18} fill={color} />;
  if (kind === "square") return <rect x={x - 17} y={y - 17} width={34} height={34} rx={4} fill={color} />;
  // triangle
  return <polygon points={`${x},${y - 19} ${x - 19},${y + 16} ${x + 19},${y + 16}`} fill={color} />;
}

export default function ShapeCount({ params }: DisplayPuzzleProps) {
  const shapes = (params.shapes as string[]) || [];
  const W = 360, H = 200, cols = 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 420 }}>
      {shapes.map((kind, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const x = 45 + col * 90, y = 40 + row * 55;
        return <Shape key={i} kind={kind} x={x} y={y} color={COLORS[i % COLORS.length]} />;
      })}
    </svg>
  );
}
