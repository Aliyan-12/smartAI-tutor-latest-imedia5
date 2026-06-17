import type { DisplayPuzzleProps } from "./types";

export default function NumberLine({ params }: DisplayPuzzleProps) {
  const min = Number(params.min) || 0;
  const max = Number(params.max) || 10;
  const step = Math.max(1, Number(params.step) || 1);
  const marker = Number(params.marker) ?? min;
  const W = 420, H = 80, pad = 24;
  const span = Math.max(1, max - min);
  const x = (v: number) => pad + ((v - min) / span) * (W - 2 * pad);

  const ticks: number[] = [];
  for (let v = min; v <= max; v += step) ticks.push(v);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 460 }}>
      <line x1={pad} y1={H / 2} x2={W - pad} y2={H / 2} stroke="#475569" strokeWidth={2} />
      {ticks.map((v) => (
        <g key={v}>
          <line x1={x(v)} y1={H / 2 - 7} x2={x(v)} y2={H / 2 + 7} stroke="#475569" strokeWidth={2} />
          <text x={x(v)} y={H / 2 + 26} textAnchor="middle" fontSize={12} fill="#64748b">{v}</text>
        </g>
      ))}
      {/* marker arrow */}
      <polygon
        points={`${x(marker)},${H / 2 - 10} ${x(marker) - 7},${H / 2 - 24} ${x(marker) + 7},${H / 2 - 24}`}
        fill="#7c3aed"
      />
      <line x1={x(marker)} y1={H / 2 - 24} x2={x(marker)} y2={H / 2 - 10} stroke="#7c3aed" strokeWidth={3} />
    </svg>
  );
}
