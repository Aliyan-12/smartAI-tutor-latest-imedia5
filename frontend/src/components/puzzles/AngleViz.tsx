import type { DisplayPuzzleProps } from "./types";

export default function AngleViz({ params }: DisplayPuzzleProps) {
  const deg = Math.max(5, Math.min(350, Number(params.degrees) || 45));
  const cx = 45, cy = 160, len = 155;
  const a = (deg * Math.PI) / 180;
  // ray 1 along +x; ray 2 rotated `deg` anticlockwise (svg y is down → negate)
  const x2 = cx + len * Math.cos(-a), y2 = cy + len * Math.sin(-a);
  const ar = 34;
  const arc = `M${cx + ar},${cy} A${ar},${ar} 0 ${deg > 180 ? 1 : 0} 0 ${cx + ar * Math.cos(-a)},${cy + ar * Math.sin(-a)}`;
  return (
    <svg viewBox="0 0 230 200" style={{ width: "100%", maxWidth: 270 }}>
      <line x1={cx} y1={cy} x2={cx + len} y2={cy} stroke="#1e293b" strokeWidth={3} strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={x2} y2={y2} stroke="#1a73e8" strokeWidth={3} strokeLinecap="round" />
      <path d={arc} fill="none" stroke="#7c3aed" strokeWidth={2} />
      <circle cx={cx} cy={cy} r={4} fill="#1e293b" />
    </svg>
  );
}
