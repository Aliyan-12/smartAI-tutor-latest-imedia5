import type { DisplayPuzzleProps } from "./types";

export default function Clock({ params }: DisplayPuzzleProps) {
  const hour = Number(params.hour) || 3;
  const minute = Number(params.minute) || 0;
  const cx = 110, cy = 110, r = 100;
  const minAngle = (minute / 60) * 2 * Math.PI - Math.PI / 2;
  const hrAngle = (((hour % 12) + minute / 60) / 12) * 2 * Math.PI - Math.PI / 2;

  const hand = (ang: number, len: number, w: number, color: string) => (
    <line x1={cx} y1={cy} x2={cx + len * Math.cos(ang)} y2={cy + len * Math.sin(ang)} stroke={color} strokeWidth={w} strokeLinecap="round" />
  );

  return (
    <svg viewBox="0 0 220 220" style={{ width: "100%", maxWidth: 230 }}>
      <circle cx={cx} cy={cy} r={r} fill="#fff" stroke="#334155" strokeWidth={3} />
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
        return (
          <line key={"t" + i} x1={cx + (r - 6) * Math.cos(a)} y1={cy + (r - 6) * Math.sin(a)}
            x2={cx + r * Math.cos(a)} y2={cy + r * Math.sin(a)} stroke="#94a3b8" strokeWidth={2} />
        );
      })}
      {Array.from({ length: 12 }).map((_, i) => {
        const n = i === 0 ? 12 : i;
        const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
        return (
          <text key={"n" + i} x={cx + (r - 20) * Math.cos(a)} y={cy + (r - 20) * Math.sin(a) + 5}
            textAnchor="middle" fontSize={15} fontWeight={700} fill="#475569">{n}</text>
        );
      })}
      {hand(hrAngle, 52, 6, "#1e293b")}
      {hand(minAngle, 80, 4, "#1a73e8")}
      <circle cx={cx} cy={cy} r={5} fill="#1e293b" />
    </svg>
  );
}
