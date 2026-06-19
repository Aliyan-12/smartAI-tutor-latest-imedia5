import type { DisplayPuzzleProps } from "./types";

export default function BalanceScales({ params }: DisplayPuzzleProps) {
  const left = String(params.left || "x + ?");
  const b = Number(params.b) || 0;
  return (
    <svg viewBox="0 0 300 180" style={{ width: "100%", maxWidth: 340 }}>
      {/* stand */}
      <line x1={150} y1={40} x2={150} y2={150} stroke="#475569" strokeWidth={4} />
      <line x1={108} y1={150} x2={192} y2={150} stroke="#475569" strokeWidth={5} strokeLinecap="round" />
      {/* beam */}
      <line x1={45} y1={50} x2={255} y2={50} stroke="#1e293b" strokeWidth={4} strokeLinecap="round" />
      <circle cx={150} cy={50} r={5} fill="#1e293b" />
      {/* hangers */}
      <line x1={72} y1={50} x2={72} y2={78} stroke="#94a3b8" strokeWidth={2} />
      <line x1={228} y1={50} x2={228} y2={78} stroke="#94a3b8" strokeWidth={2} />
      {/* pans */}
      <ellipse cx={72} cy={92} rx={48} ry={15} fill="#dbeafe" stroke="#1a73e8" strokeWidth={2} />
      <ellipse cx={228} cy={92} rx={48} ry={15} fill="#fef3c7" stroke="#f59e0b" strokeWidth={2} />
      <text x={72} y={97} textAnchor="middle" fontSize={17} fontWeight={700} fill="#1e293b">{left}</text>
      <text x={228} y={98} textAnchor="middle" fontSize={18} fontWeight={700} fill="#1e293b">{b}</text>
      <text x={150} y={175} textAnchor="middle" fontSize={12} fill="#64748b">The scales balance — find x.</text>
    </svg>
  );
}
