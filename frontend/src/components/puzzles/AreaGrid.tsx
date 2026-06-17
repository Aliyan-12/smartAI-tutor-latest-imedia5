import type { DisplayPuzzleProps } from "./types";

export default function AreaGrid({ params }: DisplayPuzzleProps) {
  const w = Math.max(1, Number(params.width) || 4);
  const h = Math.max(1, Number(params.height) || 3);
  const cell = Math.min(40, Math.floor(320 / Math.max(w, h)));
  const W = w * cell, H = h * cell;
  return (
    <svg viewBox={`0 0 ${W + 2} ${H + 2}`} style={{ width: "auto", maxWidth: "100%", maxHeight: 240 }}>
      <g transform="translate(1,1)">
        {Array.from({ length: h }).map((_, r) =>
          Array.from({ length: w }).map((_, c) => (
            <rect key={`${r}-${c}`} x={c * cell} y={r * cell} width={cell} height={cell}
              fill="#dbeafe" stroke="#1a73e8" strokeWidth={1.5} />
          ))
        )}
      </g>
    </svg>
  );
}
