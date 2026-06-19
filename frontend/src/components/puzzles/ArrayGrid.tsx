import type { DisplayPuzzleProps } from "./types";

export default function ArrayGrid({ params }: DisplayPuzzleProps) {
  const rows = Math.max(1, Number(params.rows) || 3);
  const cols = Math.max(1, Number(params.cols) || 4);
  const gap = Math.min(38, Math.floor(300 / Math.max(rows, cols)));
  const r = Math.max(5, gap * 0.32);
  const W = cols * gap, H = rows * gap;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "auto", maxWidth: "100%", maxHeight: 220 }}>
      {Array.from({ length: rows }).map((_, ri) =>
        Array.from({ length: cols }).map((_, ci) => (
          <circle key={`${ri}-${ci}`} cx={ci * gap + gap / 2} cy={ri * gap + gap / 2} r={r} fill="#1a73e8" />
        ))
      )}
    </svg>
  );
}
