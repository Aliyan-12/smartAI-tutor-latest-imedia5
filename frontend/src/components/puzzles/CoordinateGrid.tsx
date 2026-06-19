import type { DisplayPuzzleProps } from "./types";

export default function CoordinateGrid({ params }: DisplayPuzzleProps) {
  const size = Math.max(5, Math.min(10, Number(params.size) || 6));
  const x = Math.max(0, Math.min(size, Number(params.x) || 0));
  const y = Math.max(0, Math.min(size, Number(params.y) || 0));
  const W = 250, pad = 26, step = (W - 2 * pad) / size;
  const px = (v: number) => pad + v * step;
  const py = (v: number) => W - pad - v * step;

  return (
    <svg viewBox={`0 0 ${W} ${W}`} style={{ width: "100%", maxWidth: 280 }}>
      {Array.from({ length: size + 1 }).map((_, i) => (
        <g key={i}>
          <line x1={px(i)} y1={py(0)} x2={px(i)} y2={py(size)} stroke="#eef2f7" />
          <line x1={px(0)} y1={py(i)} x2={px(size)} y2={py(i)} stroke="#eef2f7" />
        </g>
      ))}
      <line x1={px(0)} y1={py(0)} x2={px(size)} y2={py(0)} stroke="#475569" strokeWidth={2} />
      <line x1={px(0)} y1={py(0)} x2={px(0)} y2={py(size)} stroke="#475569" strokeWidth={2} />
      {Array.from({ length: size + 1 }).map((_, i) => (
        <g key={"l" + i}>
          <text x={px(i)} y={py(0) + 14} textAnchor="middle" fontSize={9} fill="#94a3b8">{i}</text>
          {i > 0 && <text x={px(0) - 7} y={py(i) + 3} textAnchor="end" fontSize={9} fill="#94a3b8">{i}</text>}
        </g>
      ))}
      <circle cx={px(x)} cy={py(y)} r={6} fill="#7c3aed" stroke="#fff" strokeWidth={1.5} />
    </svg>
  );
}
