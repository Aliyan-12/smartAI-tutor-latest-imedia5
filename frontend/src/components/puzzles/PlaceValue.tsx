import type { DisplayPuzzleProps } from "./types";

/** Base-ten blocks: hundreds (10×10), tens (1×10 columns), ones (unit squares). */
export default function PlaceValue({ params }: DisplayPuzzleProps) {
  const h = Math.max(0, Math.min(9, Number(params.hundreds) || 0));
  const t = Math.max(0, Math.min(9, Number(params.tens) || 0));
  const o = Math.max(0, Math.min(9, Number(params.ones) || 0));
  const u = 7; // unit cell size

  const Hundred = ({ x }: { x: number }) => (
    <g>
      {Array.from({ length: 100 }).map((_, i) => (
        <rect key={i} x={x + (i % 10) * u} y={(Math.floor(i / 10)) * u} width={u - 1} height={u - 1} fill="#c7d2fe" stroke="#6366f1" strokeWidth={0.4} />
      ))}
    </g>
  );
  const Ten = ({ x }: { x: number }) => (
    <g>
      {Array.from({ length: 10 }).map((_, i) => (
        <rect key={i} x={x} y={i * u} width={u - 1} height={u - 1} fill="#bbf7d0" stroke="#16a34a" strokeWidth={0.4} />
      ))}
    </g>
  );
  const One = ({ x, y }: { x: number; y: number }) => (
    <rect x={x} y={y} width={u - 1} height={u - 1} fill="#fed7aa" stroke="#f97316" strokeWidth={0.5} />
  );

  let cursor = 0;
  const hX: number[] = []; for (let i = 0; i < h; i++) { hX.push(cursor); cursor += 10 * u + 8; }
  const tX: number[] = []; for (let i = 0; i < t; i++) { tX.push(cursor); cursor += u + 3; }
  cursor += 8;
  const onesStartX = cursor;
  const W = Math.max(cursor + 3 * u, 80);

  return (
    <svg viewBox={`0 0 ${W} 78`} style={{ width: "100%", maxWidth: Math.min(W * 3, 460) }}>
      {hX.map((x, i) => <Hundred key={"h" + i} x={x} />)}
      {tX.map((x, i) => <Ten key={"t" + i} x={x} />)}
      {Array.from({ length: o }).map((_, i) => (
        <One key={"o" + i} x={onesStartX + (i % 2) * (u + 2)} y={Math.floor(i / 2) * (u + 2)} />
      ))}
    </svg>
  );
}
