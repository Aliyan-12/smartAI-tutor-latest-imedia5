import type { DisplayPuzzleProps } from "./types";

export default function BarChart({ params }: DisplayPuzzleProps) {
  const bars = (params.bars as { label: string; value: number }[]) || [];
  const ask = String(params.ask || "");
  const W = 320, H = 210, pad = 30;
  const maxV = Math.max(1, ...bars.map((b) => b.value));
  const gap = (W - 2 * pad) / (bars.length || 1);
  const bw = gap * 0.6;
  const ticks = maxV <= 10 ? maxV : 5;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 380 }}>
      {/* y gridlines + labels */}
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const v = Math.round((i / ticks) * maxV);
        const y = H - pad - (v / maxV) * (H - 2 * pad);
        return (
          <g key={"y" + i}>
            <line x1={pad} y1={y} x2={W - pad} y2={y} stroke="#eef2f7" strokeWidth={1} />
            <text x={pad - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#94a3b8">{v}</text>
          </g>
        );
      })}
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#475569" strokeWidth={2} />
      {bars.map((b, i) => {
        const bh = (b.value / maxV) * (H - 2 * pad);
        const x = pad + i * gap + (gap - bw) / 2;
        const hl = b.label.toLowerCase() === ask.toLowerCase();
        return (
          <g key={i}>
            <rect x={x} y={H - pad - bh} width={bw} height={bh} rx={2}
              fill={hl ? "#7c3aed" : "#cbd5e1"} stroke={hl ? "#5b21b6" : "none"} strokeWidth={2} />
            <text x={x + bw / 2} y={H - pad + 15} textAnchor="middle" fontSize={11}
              fill={hl ? "#5b21b6" : "#64748b"} fontWeight={hl ? 700 : 400}>{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
